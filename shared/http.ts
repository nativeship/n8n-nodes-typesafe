import { NodeApiError, NodeOperationError, sleep, type IDataObject, type IHttpRequestOptions, type INode, type JsonObject } from 'n8n-workflow';

type CredentialApplication = {
	credentialType: string;
	type: 'apiKey' | 'basic' | 'bearer' | 'oauth2' | 'custom';
	location?: 'header' | 'query';
	parameter?: string;
	injections?: Array<{ target: 'header' | 'query' | 'body'; name: string; value: string }>;
};

type RequestContext = {
	getNode(): INode;
	getExecutionId?(): string;
	getCredentials(type: string): Promise<IDataObject>;
	helpers: {
		httpRequestWithAuthentication(
			this: RequestContext,
			credentialType: string,
			options: IHttpRequestOptions,
		): Promise<unknown>;
		httpRequest(options: IHttpRequestOptions): Promise<unknown>;
	};
};

type RetryContract = {
	mode: string;
	retryConnectionFailures?: boolean;
	retryTimeouts?: boolean;
	retryRateLimits?: boolean;
	retryServerErrors?: boolean;
	maxAttempts: number;
	maxElapsedMs: number;
	baseBackoffMs: number;
	maxBackoffMs: number;
	jitterRatio: number;
	idempotency?: { target: 'header' | 'query' | 'body'; parameter: string };
};

export type ServerRoute = {
	id: string;
	url: string;
	kind: string;
	variables: Array<{ name: string; default: string; enum: string[] }>;
};

export function resolveServerBaseUrl(
	context: Pick<RequestContext, 'getNode'>,
	servers: ServerRoute[],
	defaultServerId: string,
	nodeOptions: IDataObject,
	pinned: boolean,
): { url: string; blockRedirects: boolean } {
	const selected = pinned ? defaultServerId : String(nodeOptions.serverChoice ?? defaultServerId);
	const server = servers.find((candidate) => candidate.id === selected) ?? servers.find((candidate) => candidate.id === defaultServerId);
	if (!server) throw new NodeOperationError(context.getNode(), 'Destination server is not available');
	const values: Record<string, string> = {};
	for (const variable of server.variables) {
		const parameterName = `server_${server.id}_${variable.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
		const value = String(nodeOptions[parameterName] ?? variable.default).trim();
		if (!value) throw new NodeOperationError(context.getNode(), `Server variable ${variable.name} is required`);
		if (variable.enum.length > 0 && !variable.enum.includes(value)) throw new NodeOperationError(context.getNode(), `Server variable ${variable.name} is not an allowed value`);
		if (server.kind === 'tenant' && !new RegExp('^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$').test(value)) throw new NodeOperationError(context.getNode(), `Server variable ${variable.name} must be a valid tenant host label`);
		values[variable.name] = value;
	}
	const destination = server.url.replace(/\{([^}]+)\}/g, (_match, name: string) => {
		const value = values[name] ?? '';
		return name === 'baseUrl' ? value : encodeURIComponent(value);
	});
	let parsed: URL;
	try {
		parsed = new URL(destination);
	} catch {
		throw new NodeOperationError(context.getNode(), 'Destination URL is invalid');
	}
	// HTTPS is required for anything reachable off the machine. A specification
	// that declares a loopback server -- the common shape for a locally hosted
	// API -- used to generate cleanly and then fail on every execution, because
	// this check did not distinguish the two cases.
	if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
		throw new NodeOperationError(context.getNode(), 'Destination URL must use HTTPS');
	}
	parsed.hash = '';
	parsed.username = '';
	parsed.password = '';
	return { url: parsed.toString().replace(/\/+$/u, ''), blockRedirects: server.kind === 'selfHosted' };
}

function isLoopbackHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	return host === 'localhost' || host === '::1' || host.endsWith('.localhost') || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
}

function assign(target: IDataObject, name: string, value: unknown): void {
	target[name] = value as IDataObject[string];
}

function renderTemplate(template: string, credentials: IDataObject): string {
	return template.replace(/\{\{\$credentials\.([A-Za-z0-9_]+)\}\}/gu, (_, name: string) => String(credentials[name] ?? ''));
}

async function applyCredential(context: RequestContext, options: IHttpRequestOptions, application: CredentialApplication): Promise<void> {
	const credentials = await context.getCredentials(application.credentialType);
	if (application.type === 'apiKey') {
		const group = application.location === 'query' ? ((options.qs ??= {}) as IDataObject) : ((options.headers ??= {}) as IDataObject);
		// The default name has to match the credential's own authenticate block,
		// which uses 'apiKey' for a query key and 'Authorization' for a header.
		// This path used to send an unnamed query key as 'Authorization'.
		assign(group, application.parameter ?? (application.location === 'query' ? 'apiKey' : 'Authorization'), credentials.secret);
	}
	if (application.type === 'basic') {
		options.auth = { username: String(credentials.username ?? ''), password: String(credentials.password ?? '') };
	}
	if (application.type === 'bearer') {
		const headers = (options.headers ??= {}) as IDataObject;
		assign(headers, 'Authorization', `Bearer ${String(credentials.secret ?? '')}`);
	}
	if (application.type === 'custom') {
		for (const injection of application.injections ?? []) {
			const group = injection.target === 'query' ? ((options.qs ??= {}) as IDataObject) : injection.target === 'body' ? ((options.body ??= {}) as IDataObject) : ((options.headers ??= {}) as IDataObject);
			assign(group, injection.name, renderTemplate(injection.value, credentials));
		}
	}
}

function retryDelay(error: unknown, attempt: number, contract: RetryContract, elapsedMs: number): number {
	const response = (error as { response?: { headers?: Record<string, string> } }).response;
	const retryAfter = response?.headers?.['retry-after'];
	let delay: number;
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) delay = seconds * 1000;
		else {
			const date = Date.parse(retryAfter);
			delay = Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
		}
	} else {
		const backoff = Math.min(contract.maxBackoffMs, contract.baseBackoffMs * 2 ** attempt);
		const jitter = backoff * contract.jitterRatio * Math.random();
		delay = backoff + jitter;
	}
	// A delay longer than the remaining budget used to be clamped down to it,
	// so a server asking for a 60s pause was retried early and rate-limited
	// again. Signalling -1 makes the caller give up instead.
	const remaining = contract.maxElapsedMs - elapsedMs;
	return delay > remaining ? -1 : Math.max(0, delay);
}

function errorStatus(error: unknown): number | undefined {
	return (error as { statusCode?: number; response?: { statusCode?: number } }).statusCode ??
		(error as { response?: { statusCode?: number } }).response?.statusCode;
}

function isTimeout(error: unknown): boolean {
	const code = String((error as { code?: string }).code ?? '').toUpperCase();
	const message = String((error as { message?: string }).message ?? '').toLowerCase();
	return code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || message.includes('timeout');
}

function canRetry(error: unknown, contract: RetryContract): boolean {
	const status = errorStatus(error);
	if (status === 429) return Boolean(contract.retryRateLimits);
	if (status && status >= 500 && status <= 599) return Boolean(contract.retryServerErrors);
	if (isTimeout(error)) return Boolean(contract.retryTimeouts);
	if (!status) return Boolean(contract.retryConnectionFailures);
	return false;
}

function retryContractAllowsRequest(options: IHttpRequestOptions, contract: RetryContract, itemIndex?: number): boolean {
	const method = String(options.method ?? 'GET').toUpperCase();
	if (contract.mode === 'safeRead') return method === 'GET';
	if (contract.mode === 'idempotentMutation') return Boolean(contract.idempotency?.parameter && itemIndex !== undefined);
	return false;
}

function applyIdempotency(options: IHttpRequestOptions, contract: RetryContract, executionId: string, itemIndex?: number): void {
	if (!contract.idempotency || itemIndex === undefined) return;
	// The key used to be the literal text `{{$execution.id}}:<index>`. n8n only
	// resolves expressions read through getNodeParameter, never values placed
	// into IHttpRequestOptions, so every request on every instance sent the same
	// key -- worse than sending none, because a retried mutation could be
	// deduplicated against an unrelated earlier request. The execution id is
	// read from the execution context instead.
	const value = `${executionId}:${itemIndex}`;
	if (contract.idempotency.target === 'query') {
		assign((options.qs ??= {}) as IDataObject, contract.idempotency.parameter, value);
		return;
	}
	if (contract.idempotency.target === 'body') {
		assign((options.body ??= {}) as IDataObject, contract.idempotency.parameter, value);
		return;
	}
	assign((options.headers ??= {}) as IDataObject, contract.idempotency.parameter, value);
}

// selectCredentialApplications resolves the node-level authentication choice
// down to the plan the operation being executed actually offers.
//
// The choice is one node parameter, but security requirements are per
// operation, so an API whose admin operations accept only OAuth while the rest
// take an API key gives the user a choice some operations cannot honour. This
// used to fall back to the operation's first plan, whose credential the editor
// had hidden behind a `show` clause that did not match the selection -- so the
// credential was never configured and the request went out unauthenticated or
// authenticated as something the user did not pick. Failing here is the only
// honest outcome: nothing in the node can satisfy what was asked for.
export function selectCredentialApplications(
	context: Pick<RequestContext, 'getNode'>,
	alternatives: Array<{ name: string; displayName: string; applications: CredentialApplication[] }>,
	choice: string,
	operationName: string,
): CredentialApplication[] {
	const selected = alternatives.find((alternative) => alternative.name === choice);
	if (selected) return selected.applications;
	throw new NodeOperationError(
		context.getNode(),
		`The ${operationName} operation does not support the selected authentication method`,
		{ description: `Set Authentication to ${alternatives.map((alternative) => alternative.displayName).join(' or ')}.` },
	);
}

export async function requestWithRetry(
	context: RequestContext,
	options: IHttpRequestOptions,
	credentialApplications: CredentialApplication[] | undefined,
	contract: RetryContract = { mode: 'none', maxAttempts: 1, maxElapsedMs: 30000, baseBackoffMs: 500, maxBackoffMs: 5000, jitterRatio: 0 },
	itemIndex?: number,
): Promise<unknown> {
	applyIdempotency(options, contract, String(context.getExecutionId?.() ?? ''), itemIndex);
	// One credential is the overwhelmingly common case, and n8n can apply it
	// itself from the credential's `authenticate` block -- which is where token
	// refresh, credential overwrites and audit logging live. Every credential
	// used to be injected by hand instead, so that block was dead at runtime and
	// the node quietly reimplemented n8n's authentication layer. Hand injection
	// is kept only for a requirement that combines several schemes at once,
	// which httpRequestWithAuthentication cannot express.
	const applications = credentialApplications ?? [];
	const delegated = applications.length === 1 ? applications[0] : applications.find((application) => application.type === 'oauth2');
	for (const application of applications) {
		if (application !== delegated) await applyCredential(context, options, application);
	}
	const startedAt = Date.now();
	const maxAttempts = Math.max(1, contract.maxAttempts);
	for (let attempt = 0; ; attempt += 1) {
		if (attempt > 0 && Date.now() - startedAt >= contract.maxElapsedMs) {
			throw new NodeApiError(context.getNode(), { message: 'Retry elapsed-time budget was exceeded' } as JsonObject);
		}
		try {
			return delegated
				? await context.helpers.httpRequestWithAuthentication.call(context, delegated.credentialType, options)
				: await context.helpers.httpRequest(options);
		} catch (error) {
			const elapsedMs = Date.now() - startedAt;
			if (attempt + 1 >= maxAttempts || elapsedMs >= contract.maxElapsedMs || !retryContractAllowsRequest(options, contract, itemIndex) || !canRetry(error, contract)) {
				throw new NodeApiError(context.getNode(), error as JsonObject);
			}
			const delay = retryDelay(error, attempt, contract, elapsedMs);
			if (delay < 0) throw new NodeApiError(context.getNode(), error as JsonObject);
			await sleep(delay);
		}
	}
}
