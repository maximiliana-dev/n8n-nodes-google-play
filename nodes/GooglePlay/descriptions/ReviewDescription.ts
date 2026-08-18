import type { INodeProperties } from 'n8n-workflow';

export const reviewOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['review'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a review',
				description: 'Retrieve a single review by its ID',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many reviews',
				description: 'List recent reviews of an app',
			},
			{
				name: 'Reply',
				value: 'reply',
				action: 'Reply to a review',
				description: 'Post or update the developer reply to a review',
			},
		],
		default: 'getMany',
	},
];

export const reviewFields: INodeProperties[] = [
	{
		displayName:
			'The Google Play API only returns reviews that include a comment and were created or edited within the last 7 days. Older reviews are not available through the API: export them as CSV from the Google Play Console instead.',
		name: 'recentReviewsNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Package Name',
		name: 'packageName',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. com.example.app',
		description: 'Package name of the app in Google Play',
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['get', 'getMany', 'reply'],
			},
		},
	},
	{
		displayName: 'Review ID',
		name: 'reviewId',
		type: 'string',
		default: '',
		required: true,
		description: 'ID of the review, as returned by the Get Many operation or the trigger',
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['get', 'reply'],
			},
		},
	},
	{
		displayName: 'Reply Text',
		name: 'replyText',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		default: '',
		required: true,
		description:
			'Text of the developer reply, up to 350 characters. Replying again to the same review overwrites the previous reply.',
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['reply'],
			},
		},
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['getMany'],
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: {
			minValue: 1,
		},
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['getMany'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['get', 'getMany'],
			},
		},
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: {
			show: {
				resource: ['review'],
				operation: ['get', 'getMany'],
			},
		},
		options: [
			{
				displayName: 'Translation Language',
				name: 'translationLanguage',
				type: 'string',
				default: '',
				placeholder: 'e.g. es',
				description: 'BCP-47 language code to translate the review texts to, e.g. "es" or "en-GB"',
			},
		],
	},
];
