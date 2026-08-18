import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { toNodeError } from '../shared/errors';
import { reviewFields, reviewOperations } from './descriptions/ReviewDescription';
import {
	assertPackageName,
	assertReplyText,
	assertReviewId,
	googlePlayApiRequest,
	googlePlayListReviews,
} from './GenericFunctions';
import { simplifyGoogleReview, type GoogleReview } from './reviews';

export class GooglePlay implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google Play',
		name: 'googlePlay',
		icon: {
			light: 'file:icons/googlePlay.svg',
			dark: 'file:icons/googlePlay.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Fetch and reply to Google Play app reviews',
		defaults: {
			name: 'Google Play',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'googlePlayApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Review',
						value: 'review',
					},
				],
				default: 'review',
			},
			...reviewOperations,
			...reviewFields,
		],
		usableAsTool: true,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				returnData.push(...(await executeReviewOperation.call(this, operation, i)));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				throw toNodeError(this, error, i);
			}
		}

		return [returnData];
	}
}

async function executeReviewOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const packageName = assertPackageName.call(
		this,
		this.getNodeParameter('packageName', itemIndex) as string,
		itemIndex,
	);
	const pairedItem = { item: itemIndex };

	if (operation === 'getMany') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
		const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
		const simplify = this.getNodeParameter('simplify', itemIndex) as boolean;
		const options = this.getNodeParameter('options', itemIndex, {}) as {
			translationLanguage?: string;
		};

		const qs: IDataObject = {};
		if (options.translationLanguage !== undefined && options.translationLanguage.trim() !== '') {
			qs.translationLanguage = options.translationLanguage.trim();
		}

		const reviews = await googlePlayListReviews.call(this, packageName, {
			qs,
			maxReviews: returnAll ? Number.POSITIVE_INFINITY : limit,
			itemIndex,
		});

		return reviews.map((review) => ({
			json: simplify ? simplifyGoogleReview(review) : (review as unknown as IDataObject),
			pairedItem,
		}));
	}

	if (operation === 'get') {
		const reviewId = assertReviewId.call(
			this,
			this.getNodeParameter('reviewId', itemIndex) as string,
			itemIndex,
		);
		const simplify = this.getNodeParameter('simplify', itemIndex) as boolean;
		const options = this.getNodeParameter('options', itemIndex, {}) as {
			translationLanguage?: string;
		};

		const qs: IDataObject = {};
		if (options.translationLanguage !== undefined && options.translationLanguage.trim() !== '') {
			qs.translationLanguage = options.translationLanguage.trim();
		}

		const review = (await googlePlayApiRequest.call(
			this,
			'GET',
			`/applications/${encodeURIComponent(packageName)}/reviews/${encodeURIComponent(reviewId)}`,
			{ qs, itemIndex },
		)) as unknown as GoogleReview;

		return [
			{
				json: simplify ? simplifyGoogleReview(review) : (review as unknown as IDataObject),
				pairedItem,
			},
		];
	}

	if (operation === 'reply') {
		const reviewId = assertReviewId.call(
			this,
			this.getNodeParameter('reviewId', itemIndex) as string,
			itemIndex,
		);
		const replyText = assertReplyText.call(
			this,
			this.getNodeParameter('replyText', itemIndex) as string,
			itemIndex,
		);

		const response = await googlePlayApiRequest.call(
			this,
			'POST',
			`/applications/${encodeURIComponent(packageName)}/reviews/${encodeURIComponent(reviewId)}:reply`,
			{ body: { replyText }, itemIndex },
		);

		const result = (response.result ?? {}) as IDataObject;
		return [
			{
				json: { reviewId, packageName, ...result },
				pairedItem,
			},
		];
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, {
		itemIndex,
	});
}
