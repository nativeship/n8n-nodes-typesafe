"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveServerBaseUrl = resolveServerBaseUrl;
exports.selectCredentialApplications = selectCredentialApplications;
exports.requestWithRetry = requestWithRetry;
const n8n_workflow_1 = require("n8n-workflow");
function resolveServerBaseUrl(context, servers, defaultServerId, nodeOptions, pinned) {
    var _a, _b, _c;
    const selected = pinned ? defaultServerId : String((_a = nodeOptions.serverChoice) !== null && _a !== void 0 ? _a : defaultServerId);
    const server = (_b = servers.find((candidate) => candidate.id === selected)) !== null && _b !== void 0 ? _b : servers.find((candidate) => candidate.id === defaultServerId);
    if (!server)
        throw new n8n_workflow_1.NodeOperationError(context.getNode(), 'Destination server is not available');
    const values = {};
    for (const variable of server.variables) {
        const parameterName = `server_${server.id}_${variable.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
        const value = String((_c = nodeOptions[parameterName]) !== null && _c !== void 0 ? _c : variable.default).trim();
        if (!value)
            throw new n8n_workflow_1.NodeOperationError(context.getNode(), `Server variable ${variable.name} is required`);
        if (variable.enum.length > 0 && !variable.enum.includes(value))
            throw new n8n_workflow_1.NodeOperationError(context.getNode(), `Server variable ${variable.name} is not an allowed value`);
        if (server.kind === 'tenant' && !new RegExp('^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$').test(value))
            throw new n8n_workflow_1.NodeOperationError(context.getNode(), `Server variable ${variable.name} must be a valid tenant host label`);
        values[variable.name] = value;
    }
    const destination = server.url.replace(/\{([^}]+)\}/g, (_match, name) => {
        var _a;
        const value = (_a = values[name]) !== null && _a !== void 0 ? _a : '';
        return name === 'baseUrl' ? value : encodeURIComponent(value);
    });
    let parsed;
    try {
        parsed = new URL(destination);
    }
    catch {
        throw new n8n_workflow_1.NodeOperationError(context.getNode(), 'Destination URL is invalid');
    }
    if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
        throw new n8n_workflow_1.NodeOperationError(context.getNode(), 'Destination URL must use HTTPS');
    }
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    return { url: parsed.toString().replace(/\/+$/u, ''), blockRedirects: server.kind === 'selfHosted' };
}
function isLoopbackHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '::1' || host.endsWith('.localhost') || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
}
function assign(target, name, value) {
    target[name] = value;
}
function renderTemplate(template, credentials) {
    return template.replace(/\{\{\$credentials\.([A-Za-z0-9_]+)\}\}/gu, (_, name) => { var _a; return String((_a = credentials[name]) !== null && _a !== void 0 ? _a : ''); });
}
async function applyCredential(context, options, application) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const credentials = await context.getCredentials(application.credentialType);
    if (application.type === 'apiKey') {
        const group = application.location === 'query' ? ((_a = options.qs) !== null && _a !== void 0 ? _a : (options.qs = {})) : ((_b = options.headers) !== null && _b !== void 0 ? _b : (options.headers = {}));
        assign(group, (_c = application.parameter) !== null && _c !== void 0 ? _c : (application.location === 'query' ? 'apiKey' : 'Authorization'), credentials.secret);
    }
    if (application.type === 'basic') {
        options.auth = { username: String((_d = credentials.username) !== null && _d !== void 0 ? _d : ''), password: String((_e = credentials.password) !== null && _e !== void 0 ? _e : '') };
    }
    if (application.type === 'bearer') {
        const headers = ((_f = options.headers) !== null && _f !== void 0 ? _f : (options.headers = {}));
        assign(headers, 'Authorization', `Bearer ${String((_g = credentials.secret) !== null && _g !== void 0 ? _g : '')}`);
    }
    if (application.type === 'custom') {
        for (const injection of (_h = application.injections) !== null && _h !== void 0 ? _h : []) {
            const group = injection.target === 'query' ? ((_j = options.qs) !== null && _j !== void 0 ? _j : (options.qs = {})) : injection.target === 'body' ? ((_k = options.body) !== null && _k !== void 0 ? _k : (options.body = {})) : ((_l = options.headers) !== null && _l !== void 0 ? _l : (options.headers = {}));
            assign(group, injection.name, renderTemplate(injection.value, credentials));
        }
    }
}
function retryDelay(error, attempt, contract, elapsedMs) {
    var _a;
    const response = error.response;
    const retryAfter = (_a = response === null || response === void 0 ? void 0 : response.headers) === null || _a === void 0 ? void 0 : _a['retry-after'];
    let delay;
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds))
            delay = seconds * 1000;
        else {
            const date = Date.parse(retryAfter);
            delay = Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
        }
    }
    else {
        const backoff = Math.min(contract.maxBackoffMs, contract.baseBackoffMs * 2 ** attempt);
        const jitter = backoff * contract.jitterRatio * Math.random();
        delay = backoff + jitter;
    }
    const remaining = contract.maxElapsedMs - elapsedMs;
    return delay > remaining ? -1 : Math.max(0, delay);
}
function errorStatus(error) {
    var _a, _b;
    return (_a = error.statusCode) !== null && _a !== void 0 ? _a : (_b = error.response) === null || _b === void 0 ? void 0 : _b.statusCode;
}
function isTimeout(error) {
    var _a, _b;
    const code = String((_a = error.code) !== null && _a !== void 0 ? _a : '').toUpperCase();
    const message = String((_b = error.message) !== null && _b !== void 0 ? _b : '').toLowerCase();
    return code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || message.includes('timeout');
}
function canRetry(error, contract) {
    const status = errorStatus(error);
    if (status === 429)
        return Boolean(contract.retryRateLimits);
    if (status && status >= 500 && status <= 599)
        return Boolean(contract.retryServerErrors);
    if (isTimeout(error))
        return Boolean(contract.retryTimeouts);
    if (!status)
        return Boolean(contract.retryConnectionFailures);
    return false;
}
function retryContractAllowsRequest(options, contract, itemIndex) {
    var _a, _b;
    const method = String((_a = options.method) !== null && _a !== void 0 ? _a : 'GET').toUpperCase();
    if (contract.mode === 'safeRead')
        return method === 'GET';
    if (contract.mode === 'idempotentMutation')
        return Boolean(((_b = contract.idempotency) === null || _b === void 0 ? void 0 : _b.parameter) && itemIndex !== undefined);
    return false;
}
function applyIdempotency(options, contract, executionId, itemIndex) {
    var _a, _b, _c;
    if (!contract.idempotency || itemIndex === undefined)
        return;
    const value = `${executionId}:${itemIndex}`;
    if (contract.idempotency.target === 'query') {
        assign(((_a = options.qs) !== null && _a !== void 0 ? _a : (options.qs = {})), contract.idempotency.parameter, value);
        return;
    }
    if (contract.idempotency.target === 'body') {
        assign(((_b = options.body) !== null && _b !== void 0 ? _b : (options.body = {})), contract.idempotency.parameter, value);
        return;
    }
    assign(((_c = options.headers) !== null && _c !== void 0 ? _c : (options.headers = {})), contract.idempotency.parameter, value);
}
function selectCredentialApplications(context, alternatives, choice, operationName) {
    const selected = alternatives.find((alternative) => alternative.name === choice);
    if (selected)
        return selected.applications;
    throw new n8n_workflow_1.NodeOperationError(context.getNode(), `The ${operationName} operation does not support the selected authentication method`, { description: `Set Authentication to ${alternatives.map((alternative) => alternative.displayName).join(' or ')}.` });
}
async function requestWithRetry(context, options, credentialApplications, contract = { mode: 'none', maxAttempts: 1, maxElapsedMs: 30000, baseBackoffMs: 500, maxBackoffMs: 5000, jitterRatio: 0 }, itemIndex) {
    var _a, _b;
    applyIdempotency(options, contract, String((_b = (_a = context.getExecutionId) === null || _a === void 0 ? void 0 : _a.call(context)) !== null && _b !== void 0 ? _b : ''), itemIndex);
    const applications = credentialApplications !== null && credentialApplications !== void 0 ? credentialApplications : [];
    const delegated = applications.length === 1 ? applications[0] : applications.find((application) => application.type === 'oauth2');
    for (const application of applications) {
        if (application !== delegated)
            await applyCredential(context, options, application);
    }
    const startedAt = Date.now();
    const maxAttempts = Math.max(1, contract.maxAttempts);
    for (let attempt = 0;; attempt += 1) {
        if (attempt > 0 && Date.now() - startedAt >= contract.maxElapsedMs) {
            throw new n8n_workflow_1.NodeApiError(context.getNode(), { message: 'Retry elapsed-time budget was exceeded' });
        }
        try {
            return delegated
                ? await context.helpers.httpRequestWithAuthentication.call(context, delegated.credentialType, options)
                : await context.helpers.httpRequest(options);
        }
        catch (error) {
            const elapsedMs = Date.now() - startedAt;
            if (attempt + 1 >= maxAttempts || elapsedMs >= contract.maxElapsedMs || !retryContractAllowsRequest(options, contract, itemIndex) || !canRetry(error, contract)) {
                throw new n8n_workflow_1.NodeApiError(context.getNode(), error);
            }
            const delay = retryDelay(error, attempt, contract, elapsedMs);
            if (delay < 0)
                throw new n8n_workflow_1.NodeApiError(context.getNode(), error);
            await (0, n8n_workflow_1.sleep)(delay);
        }
    }
}
//# sourceMappingURL=http.js.map