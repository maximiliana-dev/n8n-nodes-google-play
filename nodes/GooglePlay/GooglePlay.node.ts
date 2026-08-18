import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { MAIN_CONNECTION } from '../shared/connections';
import { toNodeError } from '../shared/errors';
import { apkFields, apkOperations } from './descriptions/ApkDescription';
import { reviewFields, reviewOperations } from './descriptions/ReviewDescription';
import {
	assertPackageName,
	assertReplyText,
	assertReviewId,
	assertVersionCode,
	googlePlayApiRequest,
	googlePlayApiRequestBinary,
	googlePlayGetProductionTrack,
	googlePlayListReviews,
	searchApps,
} from './GenericFunctions';
import {
	pickLatestVersionCode,
	pickUniversalApk,
	type GeneratedApksListResponse,
} from './releases';
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
		description: 'Fetch and reply to Google Play app reviews, and download signed universal APKs',
		defaults: {
			name: 'Google Play',
		},
		inputs: [MAIN_CONNECTION],
		outputs: [MAIN_CONNECTION],
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
						name: 'APK',
						value: 'apk',
					},
					{
						name: 'Review',
						value: 'review',
					},
				],
				default: 'review',
			},
			...reviewOperations,
			...reviewFields,
			...apkOperations,
			...apkFields,
		],
		usableAsTool: true,
	};

	methods = {
		listSearch: {
			searchApps,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				returnData.push(
					...(resource === 'apk'
						? await executeApkOperation.call(this, operation, i)
						: await executeReviewOperation.call(this, operation, i)),
				);
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
		this.getNodeParameter('packageName', itemIndex, undefined, { extractValue: true }) as string,
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

async function executeApkOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation !== 'downloadUniversal') {
		throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, {
			itemIndex,
		});
	}

	const packageName = assertPackageName.call(
		this,
		this.getNodeParameter('packageName', itemIndex, undefined, { extractValue: true }) as string,
		itemIndex,
	);
	const versionSelection = this.getNodeParameter('versionSelection', itemIndex) as string;
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as { fileName?: string };

	let versionCode: number;
	if (versionSelection === 'specific') {
		versionCode = assertVersionCode.call(
			this,
			this.getNodeParameter('versionCode', itemIndex) as number,
			itemIndex,
		);
	} else {
		const track = await googlePlayGetProductionTrack.call(this, packageName, itemIndex);
		const latest = pickLatestVersionCode(track);
		if (latest === undefined) {
			throw new NodeOperationError(
				this.getNode(),
				`No live release was found on the production track of "${packageName}"`,
				{ itemIndex },
			);
		}
		versionCode = latest;
	}

	const generatedApks = (await googlePlayApiRequest.call(
		this,
		'GET',
		`/applications/${encodeURIComponent(packageName)}/generatedApks/${versionCode}`,
		{ itemIndex },
	)) as GeneratedApksListResponse;

	const universalApk = pickUniversalApk(generatedApks);
	if (universalApk === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`Google Play has no universal APK for version code ${versionCode} of "${packageName}". Universal APKs are only generated for apps published as App Bundles with Play App Signing.`,
			{ itemIndex },
		);
	}

	const content = await googlePlayApiRequestBinary.call(
		this,
		`/applications/${encodeURIComponent(packageName)}/generatedApks/${versionCode}/downloads/${encodeURIComponent(universalApk.downloadId)}:download`,
		{ qs: { alt: 'media' }, itemIndex },
	);

	const trimmedFileName = options.fileName?.trim() ?? '';
	const fileName =
		trimmedFileName === '' ? `${packageName}-${versionCode}-universal.apk` : trimmedFileName;

	const binary = await this.helpers.prepareBinaryData(
		content,
		fileName,
		'application/vnd.android.package-archive',
	);

	return [
		{
			json: {
				packageName,
				versionCode,
				fileName,
				fileSize: content.length,
				certificateSha256Hash: universalApk.certificateSha256Hash,
			},
			binary: { [binaryPropertyName.trim() === '' ? 'data' : binaryPropertyName.trim()]: binary },
			pairedItem: { item: itemIndex },
		},
	];
}
