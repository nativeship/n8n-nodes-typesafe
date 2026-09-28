import { type IDataObject, type IHttpRequestOptions, type INode } from 'n8n-workflow';
type CredentialApplication = {
    credentialType: string;
    type: 'apiKey' | 'basic' | 'bearer' | 'oauth2' | 'custom';
    location?: 'header' | 'query';
    parameter?: string;
    injections?: Array<{
        target: 'header' | 'query' | 'body';
        name: string;
        value: string;
    }>;
};
type RequestContext = {
    getNode(): INode;
    getExecutionId?(): string;
    getCredentials(type: string): Promise<IDataObject>;
    helpers: {
        httpRequestWithAuthentication(this: RequestContext, credentialType: string, options: IHttpRequestOptions): Promise<unknown>;
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
    idempotency?: {
        target: 'header' | 'query' | 'body';
        parameter: string;
    };
};
export type ServerRoute = {
    id: string;
    url: string;
    kind: string;
    variables: Array<{
        name: string;
        default: string;
        enum: string[];
    }>;
};
export declare function resolveServerBaseUrl(context: Pick<RequestContext, 'getNode'>, servers: ServerRoute[], defaultServerId: string, nodeOptions: IDataObject, pinned: boolean): {
    url: string;
    blockRedirects: boolean;
};
export declare function selectCredentialApplications(context: Pick<RequestContext, 'getNode'>, alternatives: Array<{
    name: string;
    displayName: string;
    applications: CredentialApplication[];
}>, choice: string, operationName: string): CredentialApplication[];
export declare function requestWithRetry(context: RequestContext, options: IHttpRequestOptions, credentialApplications: CredentialApplication[] | undefined, contract?: RetryContract, itemIndex?: number): Promise<unknown>;
export {};
