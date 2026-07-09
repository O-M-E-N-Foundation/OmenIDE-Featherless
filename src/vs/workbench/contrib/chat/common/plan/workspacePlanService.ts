/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IOmenPlanMetadata, parsePlanFrontmatter, serializePlanContent, slugifyPlanTitle } from './planFrontmatter.js';

export const OMEN_PLANS_DIR = '.omen/plans';
export const OMEN_PLAN_GLOB = '**/.omen/plans/**/*.plan.md';

export const IWorkspacePlanService = createDecorator<IWorkspacePlanService>('workspacePlanService');

export interface ICreatePlanOptions {
	readonly sessionResource?: URI;
	readonly title: string;
	readonly content: string;
	readonly overview?: string;
}

export interface IMarkBuiltOptions {
	readonly model?: string;
	readonly session?: string;
}

export interface IWorkspacePlanService {
	readonly _serviceBrand: undefined;
	readonly onDidChangePlan: Event<URI>;

	createPlan(options: ICreatePlanOptions): Promise<URI>;
	updatePlan(uri: URI, content: string): Promise<void>;
	getPlanMetadata(uri: URI): Promise<IOmenPlanMetadata>;
	getPlanBody(uri: URI): Promise<string>;
	markBuilt(uri: URI, options?: IMarkBuiltOptions): Promise<void>;
	setBuildModel(uri: URI, model: string): Promise<void>;
	isOmenPlanUri(uri: URI): boolean;
	getPlansDirectory(): URI | undefined;
	importExternalPlan(content: string, title: string, overview?: string): Promise<URI>;
}

export class WorkspacePlanService extends Disposable implements IWorkspacePlanService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePlan = this._register(new Emitter<URI>());
	readonly onDidChangePlan = this._onDidChangePlan.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	isOmenPlanUri(uri: URI): boolean {
		if (uri.scheme !== 'file') {
			return false;
		}
		const normalized = uri.path.replace(/\\/g, '/').toLowerCase();
		return normalized.includes('/.omen/plans/') && normalized.endsWith('.plan.md');
	}

	getPlansDirectory(): URI | undefined {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}
		return URI.joinPath(folder.uri, OMEN_PLANS_DIR);
	}

	async createPlan(options: ICreatePlanOptions): Promise<URI> {
		const plansDir = await this.ensurePlansDirectory();
		const slug = slugifyPlanTitle(options.title);
		const id = generateUuid().replace(/-/g, '').slice(0, 8);
		const fileName = `${slug}_${id}.plan.md`;
		const uri = URI.joinPath(plansDir, fileName);

		const metadata: IOmenPlanMetadata = {
			createdAt: new Date().toISOString(),
			overview: options.overview,
			built: false,
		};
		const fileContent = serializePlanContent(metadata, options.content);
		await this.fileService.writeFile(uri, VSBuffer.fromString(fileContent));
		this._onDidChangePlan.fire(uri);
		return uri;
	}

	async importExternalPlan(content: string, title: string, overview?: string): Promise<URI> {
		const { body } = parsePlanFrontmatter(content);
		return this.createPlan({ title, content: body, overview });
	}

	async updatePlan(uri: URI, content: string): Promise<void> {
		const existing = await this.fileService.readFile(uri);
		const text = existing.value.toString();
		const { metadata } = parsePlanFrontmatter(text);
		const fileContent = serializePlanContent(metadata, content);
		await this.fileService.writeFile(uri, VSBuffer.fromString(fileContent));
		this._onDidChangePlan.fire(uri);
	}

	async getPlanMetadata(uri: URI): Promise<IOmenPlanMetadata> {
		const existing = await this.fileService.readFile(uri);
		return parsePlanFrontmatter(existing.value.toString()).metadata;
	}

	async getPlanBody(uri: URI): Promise<string> {
		const existing = await this.fileService.readFile(uri);
		return parsePlanFrontmatter(existing.value.toString()).body;
	}

	async markBuilt(uri: URI, options?: IMarkBuiltOptions): Promise<void> {
		const existing = await this.fileService.readFile(uri);
		const text = existing.value.toString();
		const { metadata, body } = parsePlanFrontmatter(text);
		const updated: IOmenPlanMetadata = {
			...metadata,
			built: true,
			builtAt: new Date().toISOString(),
			buildModel: options?.model ?? metadata.buildModel,
			buildSession: options?.session ?? metadata.buildSession,
		};
		await this.fileService.writeFile(uri, VSBuffer.fromString(serializePlanContent(updated, body)));
		this._onDidChangePlan.fire(uri);
	}

	async setBuildModel(uri: URI, model: string): Promise<void> {
		const existing = await this.fileService.readFile(uri);
		const text = existing.value.toString();
		const { metadata, body } = parsePlanFrontmatter(text);
		const updated: IOmenPlanMetadata = { ...metadata, buildModel: model };
		await this.fileService.writeFile(uri, VSBuffer.fromString(serializePlanContent(updated, body)));
		this._onDidChangePlan.fire(uri);
	}

	private async ensurePlansDirectory(): Promise<URI> {
		const plansDir = this.getPlansDirectory();
		if (!plansDir) {
			throw new Error('No workspace folder available for plan creation.');
		}
		try {
			await this.fileService.createFolder(plansDir);
		} catch {
			// folder may already exist
		}
		return plansDir;
	}
}
