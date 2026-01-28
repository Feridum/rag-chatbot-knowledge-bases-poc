import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { BedrockAgentClient, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";
import * as p from '@clack/prompts';
import color from 'picocolors';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG = {
  region: process.env.AWS_REGION || "us-east-1",
  s3BucketName: process.env.S3_BUCKET_NAME || "",
  knowledgeBaseId: process.env.KB_ID || "",
  dataSourceId: process.env.DATA_SOURCE_ID || "",
};

const s3Client = new S3Client({ region: CONFIG.region });
const bedrockAgentClient = new BedrockAgentClient({ region: CONFIG.region });
const DOCUMENTS_DIR = path.resolve(process.cwd(), 'documents');

async function ensureDocumentsDir(): Promise<void> {
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
}

async function getLocalDocumentFiles(): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(DOCUMENTS_DIR);
  return files;
}

async function getExistingKeys(bucketName: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    });
    const response = await s3Client.send(command);
    response.Contents?.forEach(item => {
      if (item.Key) keys.add(item.Key);
    });
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function uploadDocuments(bucketName: string): Promise<void> {
  await ensureDocumentsDir();
  const localFiles = await getLocalDocumentFiles();

  if (localFiles.length === 0) {
    p.log.info(`No files found in ${color.cyan(DOCUMENTS_DIR)} to upload.`);
    return;
  }

  const existingKeys = await getExistingKeys(bucketName);
  const s = p.spinner();
  s.start(`Uploading ${localFiles.length} files to s3://${bucketName}/`);

  let uploaded = 0;
  let skipped = 0;

  for (const filePath of localFiles) {
    const key = path.relative(DOCUMENTS_DIR, filePath).replace(/\\/g, '/');
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    const body = await fs.readFile(filePath);
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
    });
    await s3Client.send(command);
    uploaded++;
  }

  s.stop(`Upload complete. Uploaded: ${color.cyan(String(uploaded))}, Skipped: ${color.dim(String(skipped))}`);
}

async function startIngestionJob(knowledgeBaseId: string, dataSourceId: string): Promise<void> {
  const s = p.spinner();
  s.start('Starting ingestion job');

  const command = new StartIngestionJobCommand({
    knowledgeBaseId,
    dataSourceId,
    description: "Manual ingestion of documents from S3",
  });

  try {
    const response = await bedrockAgentClient.send(command);
    const jobId = response.ingestionJob!.ingestionJobId!;
    const status = response.ingestionJob!.status!;

    s.stop(`Ingestion job started: ${color.cyan(jobId)}`);
    p.log.info(`Status: ${color.dim(status)}`);
  } catch (error: any) {
    s.stop('Failed to start ingestion', 1);
    p.log.error(error.message);
    throw error;
  }
}

async function main() {
  console.clear();
  p.intro(color.bgCyan(color.black(' Upload Documents to Bedrock KB ')));

  p.log.info(`Region: ${color.cyan(CONFIG.region)}`);
  p.log.info(`Documents Bucket: ${color.cyan(CONFIG.s3BucketName || 'Not set')}`);
  p.log.info(`Knowledge Base ID: ${color.cyan(CONFIG.knowledgeBaseId || 'Not set')}`);
  p.log.info(`Data Source ID: ${color.cyan(CONFIG.dataSourceId || 'Not set')}`);

  if (!CONFIG.s3BucketName || !CONFIG.knowledgeBaseId || !CONFIG.dataSourceId) {
    p.log.error('S3_BUCKET_NAME, KB_ID and DATA_SOURCE_ID environment variables are required');
    p.outro(color.red('Upload aborted'));
    process.exit(1);
  }

  try {
    await uploadDocuments(CONFIG.s3BucketName);
    await startIngestionJob(CONFIG.knowledgeBaseId, CONFIG.dataSourceId);
    p.outro(color.green('Upload and ingestion started successfully! ✨'));
  } catch (error: any) {
    p.log.error(`Upload failed: ${error.message}`);
    p.outro(color.red('Upload failed'));
    process.exit(1);
  }
}

main();
