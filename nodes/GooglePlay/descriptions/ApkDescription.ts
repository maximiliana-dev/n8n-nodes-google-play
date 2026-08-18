import type { INodeProperties } from 'n8n-workflow';

export const apkOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['apk'],
			},
		},
		options: [
			{
				name: 'Download Universal',
				value: 'downloadUniversal',
				action: 'Download a universal APK',
				description: 'Download the signed universal APK that Google Play generates for a version',
			},
		],
		default: 'downloadUniversal',
	},
];

export const apkFields: INodeProperties[] = [
	{
		displayName:
			'Google Play only generates universal APKs for apps published as App Bundles with Play App Signing enabled',
		name: 'universalApkNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				resource: ['apk'],
				operation: ['downloadUniversal'],
			},
		},
	},
	{
		displayName: 'App',
		name: 'packageName',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The app whose APK to download',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchApps',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. com.example.app',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+',
							errorMessage: 'The ID must be the Android package name of the app',
						},
					},
				],
			},
		],
		displayOptions: {
			show: {
				resource: ['apk'],
				operation: ['downloadUniversal'],
			},
		},
	},
	{
		displayName: 'Version',
		name: 'versionSelection',
		type: 'options',
		options: [
			{
				name: 'Latest Production Release',
				value: 'latest',
				description: 'The highest version code currently rolled out on the production track',
			},
			{
				name: 'Specific Version Code',
				value: 'specific',
				description: 'A version code chosen manually',
			},
		],
		default: 'latest',
		displayOptions: {
			show: {
				resource: ['apk'],
				operation: ['downloadUniversal'],
			},
		},
	},
	{
		displayName: 'Version Code',
		name: 'versionCode',
		type: 'number',
		typeOptions: {
			minValue: 1,
		},
		default: 1,
		required: true,
		description: 'Version code of the release to download, as shown in the Google Play Console',
		displayOptions: {
			show: {
				resource: ['apk'],
				operation: ['downloadUniversal'],
				versionSelection: ['specific'],
			},
		},
	},
	{
		displayName: 'Put Output in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: {
			show: {
				resource: ['apk'],
				operation: ['downloadUniversal'],
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
				resource: ['apk'],
				operation: ['downloadUniversal'],
			},
		},
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. app-universal.apk',
				description:
					'Name of the downloaded file. Defaults to "&lt;package&gt;-&lt;versionCode&gt;-universal.apk".',
			},
		],
	},
];
