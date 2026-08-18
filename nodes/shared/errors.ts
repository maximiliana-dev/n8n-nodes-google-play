import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export type RequestContext = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;

export type ErrorMessageExtractor = (body: unknown) => string | undefined;

const MAX_ERROR_MESSAGE_LENGTH = 300;

/**
 * Returns the error as a typed n8n error, wrapping anything that is not one
 * already. Meant for `throw toNodeError(...)` in catch blocks.
 */
export function toNodeError(
	context: RequestContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		return error;
	}
	return new NodeOperationError(context.getNode(), error as Error, { itemIndex });
}

export function truncateErrorMessage(message: string): string {
	return message.length > MAX_ERROR_MESSAGE_LENGTH
		? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
		: message;
}

export function parseJsonBody(body: unknown): unknown {
	if (typeof body !== 'string') {
		return body;
	}
	const trimmed = body.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
		return body;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return body;
	}
}

/**
 * Rethrows API failures surfacing the store's response message instead of
 * n8n's generic per-status text, with only safe context: no request config,
 * no headers, no credentials.
 */
export function toSanitizedApiError(
	context: RequestContext,
	error: unknown,
	extractMessage: ErrorMessageExtractor,
	apiLabel: string,
	itemIndex?: number,
): NodeApiError {
	let statusCode: string | undefined;
	let responseBody: unknown;
	let fallbackDetail: string | undefined;
	let rawMessage: string | undefined;

	if (error instanceof NodeApiError) {
		// httpRequestWithAuthentication already wrapped the failure; recover the
		// response the API sent and rebuild the error with its actual message.
		statusCode = error.httpCode ?? undefined;
		responseBody = error.context.data;
		fallbackDetail = error.description ?? undefined;
		rawMessage = error.message;
	} else {
		const anyError = error as {
			message?: string;
			response?: { status?: number; statusCode?: number; data?: unknown; body?: unknown };
			statusCode?: number;
		};
		const status =
			anyError.response?.status ?? anyError.response?.statusCode ?? anyError.statusCode;
		statusCode = status !== undefined ? String(status) : undefined;
		responseBody = anyError.response?.data ?? anyError.response?.body;
		rawMessage = anyError.message;
	}

	const detail = extractMessage(parseJsonBody(responseBody)) ?? fallbackDetail;

	const safeError: JsonObject = {
		message: detail ?? rawMessage ?? 'Unknown error',
	};
	if (statusCode !== undefined) safeError.statusCode = statusCode;
	if (responseBody !== undefined) {
		try {
			safeError.responseBody = JSON.parse(JSON.stringify(responseBody)) as JsonObject;
		} catch {
			safeError.responseBody = String(responseBody);
		}
	}

	// UX guidelines: describe what happened without words like "error" or "failure"
	let message: string | undefined;
	if (detail !== undefined) {
		message =
			statusCode !== undefined
				? `${apiLabel} responded with HTTP ${statusCode}: ${detail}`
				: `${apiLabel} responded: ${detail}`;
	} else if (statusCode !== undefined) {
		message = `${apiLabel} responded with HTTP ${statusCode}`;
	}

	return new NodeApiError(context.getNode(), safeError, {
		message,
		httpCode: statusCode,
		itemIndex,
	});
}
