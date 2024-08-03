import { GitHubClient, ActionLogger, Repo } from "./types";
import { writeFile, readFile } from "fs/promises";
import { execSync } from "child_process";
import { resolve } from "path";

export class ArtifactManager {
  constructor(
    private readonly api: GitHubClient,
    private readonly logger: ActionLogger,
    private readonly artifactName: string,
  ) { }

  async getPreviousArtifact(repo: Repo, workflowName: string): Promise<string | null> {
    this.logger.info(`Looking for previous artifact for file: ${workflowName}`);
    const workflows = await this.api.rest.actions.listRepoWorkflows(repo);

    this.logger.info("Available workflows: " + JSON.stringify(workflows.data.workflows.map(w => w?.name)));
    const workflow = workflows.data.workflows.find(w => w.name === workflowName);

    if (!workflow) {
      this.logger.error("No workflow file found");
      return null;
    }

    this.logger.info(`Found workflow for ${workflow.name}`);

    const runs = await this.api.rest.actions.listWorkflowRuns({
      ...repo,
      workflow_id: workflow.id,
      status: "success",
      per_page: 1
    });

    if (runs.data.total_count === 0) {
      this.logger.error("No runs detected. Is this the first run?");
      return null;
    }

    this.logger.info(`Found ${runs.data.total_count} runs: ${JSON.stringify(runs.data.workflow_runs.map(w => w.run_started_at))}`)

    for (const run of runs.data.workflow_runs) {
      this.logger.info(`Searching for artifact in ${run.name}: ${run.id} - ${run.run_started_at}`);
      const artifacts = await this.api.rest.actions.listWorkflowRunArtifacts({
        ...repo,
        run_id: run.id
      });

      this.logger.info(`Found the following ${artifacts.data.total_count} artifacts: ${artifacts.data.artifacts.map(a => a.name)}`);

      this.logger.info(`Searching for artifact named ${this.artifactName}`);

      const artifact = artifacts.data.artifacts.find(artifact => artifact.name === this.artifactName);

      if (!artifact) {
        this.logger.info(`Found no artifact in ${run.name}: ${run.id}`);
        this.logger.info(`Available artifacts ${artifacts.data.artifacts.map(a => a.name)}`);
        return null;
      }

      const response = await this.api.rest.actions.downloadArtifact({
        ...repo,
        artifact_id: artifact.id,
        archive_format: "zip"
      });
      await writeFile(this.artifactName, Buffer.from(response.data as string));
      execSync(`unzip -o ${this.artifactName} -d ./logs`);

      this.logger.info("Artifact downloaded correctly");

      const artifactLocation = resolve(`./logs/${this.artifactName}.json`);
      this.logger.info("Artifact downloaded to " + artifactLocation);
      
      const file = await readFile(artifactLocation, "utf-8");
      this.logger.debug(`Old artifact: ${file}`);
      return file;
    }
    return null;
  }


  generateArtifact(reports: Array<[string, boolean]>) {
    const file: Array<{
      name: string, status: Array<{
        result: number;
        timestamp: number;
      }>
    }> = [];
    for (const [name, result] of reports) {
      const metric: {
        name: string, status: Array<{
          result: number;
          timestamp: number;
        }>
      } = { name, status: [{ result: result ? 0 : 1, timestamp: new Date().getTime() }] };
      file.push(metric);
    }

    return writeFile(`${this.artifactName}.json`, JSON.stringify(file));
  }
}

