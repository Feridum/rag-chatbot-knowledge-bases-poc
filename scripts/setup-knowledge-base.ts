import { S3Client, CreateBucketCommand, waitUntilBucketExists, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3VectorsClient, CreateVectorBucketCommand, CreateIndexCommand, DistanceMetric } from "@aws-sdk/client-s3vectors";
import { 
  BedrockAgentClient, 
  CreateKnowledgeBaseCommand,
  CreateDataSourceCommand,
  StartIngestionJobCommand,
  GetKnowledgeBaseCommand,
} from "@aws-sdk/client-bedrock-agent";
import * as p from '@clack/prompts';
import color from 'picocolors';
import * as fs from 'fs/promises';
import * as path from 'path';
// Configuration
const CONFIG = {
  region: process.env.AWS_REGION || "us-east-1",
  s3BucketName: process.env.S3_BUCKET_NAME || `kb-documents-${Date.now()}`,
  s3VectorsBucketName: process.env.S3_VECTORS_BUCKET_NAME || `kb-vectors-${Date.now()}`,
  knowledgeBaseName: process.env.KB_NAME || `my-knowledge-base-${Date.now()}`,
  embeddingModel: process.env.EMBEDDING_MODEL || "amazon.titan-embed-text-v2:0",
  roleArn: process.env.BEDROCK_KB_ROLE_ARN || "",
  indexName: process.env.S3_VECTORS_INDEX_NAME || "kb-index",
};

// Initialize AWS clients
const s3Client = new S3Client({ region: CONFIG.region });
const s3VectorsClient = new S3VectorsClient({ region: CONFIG.region });
const bedrockAgentClient = new BedrockAgentClient({ region: CONFIG.region });

const DOCUMENTS_DIR = path.resolve(process.cwd(), 'documents');


// Create S3 bucket for documents
async function createDocumentsBucket(bucketName: string): Promise<string> {
  const s = p.spinner();
  s.start(`Creating S3 bucket for documents: ${bucketName}`);
  
  try {
    const command = new CreateBucketCommand({
      Bucket: bucketName,
    });
    
    await s3Client.send(command);
    
    // Wait for bucket to exist
    await waitUntilBucketExists({ client: s3Client, maxWaitTime: 60 }, { Bucket: bucketName });
    s.stop(`S3 bucket ready: ${color.cyan(bucketName)}`);
    
    return bucketName;
  } catch (error: any) {
    if (error.name === 'BucketAlreadyOwnedByYou') {
      s.stop(`S3 bucket already exists: ${color.cyan(bucketName)}`);
      return bucketName;
    }
    s.stop(`Failed to create S3 bucket`, 1);
    throw error;
  }
}

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

// Create S3 Vectors bucket for embeddings
async function createVectorsBucket(bucketName: string): Promise<string> {
  const s = p.spinner();
  s.start(`Creating S3 Vectors bucket: ${bucketName}`);
  
  try {
    const command = new CreateVectorBucketCommand({
      vectorBucketName: bucketName,
    });
    
    const response = await s3VectorsClient.send(command);
    const arn = response.vectorBucketArn!;
    s.stop(`S3 Vectors bucket created: ${color.cyan(bucketName)}`);
    p.log.info(`ARN: ${color.dim(arn)}`);
    
    return arn;
  } catch (error: any) {
    if (error.name === 'VectorBucketAlreadyExists') {
      s.stop(`S3 Vectors bucket already exists: ${color.cyan(bucketName)}`);
    } else {
      s.stop(`Failed to create S3 Vectors bucket`, 1);
    }
    throw error;
  }
}

// Create index in S3 Vectors bucket
async function createVectorIndex(
  vectorBucketArn: string,
  indexName: string
): Promise<string> {
  const s = p.spinner();
  s.start(`Creating vector index: ${indexName}`);
  
  try {
    const command = new CreateIndexCommand({
      vectorBucketArn: vectorBucketArn,
      indexName: indexName,
      dimension: 1024, // Titan Embed Text v2 dimension
      distanceMetric: DistanceMetric.COSINE,
      dataType: "float32",
      metadataConfiguration: {
        nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'],
      },
    });
    
    const response = await s3VectorsClient.send(command);
    const indexArn = response.indexArn!;
    s.stop(`Vector index created: ${color.cyan(indexName)}`);
    p.log.info(`Dimensions: ${color.dim('1024')} | Similarity: ${color.dim('COSINE')}`)
    p.log.info(`ARN: ${color.dim(indexArn)}`);
    
    return indexArn;
  } catch (error: any) {
    if (error.name === 'IndexAlreadyExists') {
      const indexArn = `${vectorBucketArn}/index/${indexName}`;
      s.stop(`Vector index already exists: ${color.cyan(indexName)}`);
      p.log.info(`ARN: ${color.dim(indexArn)}`);
      return indexArn;
    } else {
      s.stop(`Failed to create vector index`, 1);
      throw error;
    }
  }
}

// Create Bedrock Knowledge Base
async function createKnowledgeBase(
  roleArn: string,
  vectorBucketArn: string,
  indexArn: string
): Promise<string> {
  console.log(`\n🧠 Creating Bedrock Knowledge Base: ${CONFIG.knowledgeBaseName}`);
  
  const command = new CreateKnowledgeBaseCommand({
    name: CONFIG.knowledgeBaseName,
    description: "Knowledge base using S3 Vectors for embeddings storage",
    roleArn: roleArn,
    knowledgeBaseConfiguration: {
      type: "VECTOR",
      vectorKnowledgeBaseConfiguration: {
        embeddingModelArn: `arn:aws:bedrock:${CONFIG.region}::foundation-model/${CONFIG.embeddingModel}`,
        embeddingModelConfiguration: {
          bedrockEmbeddingModelConfiguration: {
            dimensions: 1024, // Titan Embed Text v2 dimension
          }
        }
      }
    },
    storageConfiguration: {
      type: "S3_VECTORS",
      s3VectorsConfiguration: {
        vectorBucketArn: vectorBucketArn,
        indexArn: indexArn,
      }
    }
  });
  
  try {
    const response = await bedrockAgentClient.send(command);
    const kbId = response.knowledgeBase!.knowledgeBaseId!;
    console.log(`✓ Knowledge Base created: ${kbId}`);
    console.log(`  Name: ${response.knowledgeBase!.name}`);
    console.log(`  ARN: ${response.knowledgeBase!.knowledgeBaseArn}`);
    console.log(`  Status: ${response.knowledgeBase!.status}`);
    
    return kbId;
  } catch (error: any) {
    console.error(`✗ Failed to create knowledge base:`, error.message);
    throw error;
  }
}

// Create Data Source for S3 bucket
async function createDataSource(
  knowledgeBaseId: string,
  s3BucketName: string
): Promise<string> {
  console.log(`\n📁 Creating Data Source for S3 bucket`);
  
  const command = new CreateDataSourceCommand({
    knowledgeBaseId: knowledgeBaseId,
    name: `${s3BucketName}-datasource`,
    description: "S3 data source for document ingestion",
    dataSourceConfiguration: {
      type: "S3",
      s3Configuration: {
        bucketArn: `arn:aws:s3:::${s3BucketName}`,
      }
    },
    vectorIngestionConfiguration: {
      chunkingConfiguration: {
        chunkingStrategy: "FIXED_SIZE",
        fixedSizeChunkingConfiguration: {
          maxTokens: 512,
          overlapPercentage: 20,
        }
      }
    }
  });
  
  try {
    const response = await bedrockAgentClient.send(command);
    const dataSourceId = response.dataSource!.dataSourceId!;
    console.log(`✓ Data Source created: ${dataSourceId}`);
    console.log(`  Name: ${response.dataSource!.name}`);
    console.log(`  Status: ${response.dataSource!.status}`);
    
    return dataSourceId;
  } catch (error: any) {
    console.error(`✗ Failed to create data source:`, error.message);
    throw error;
  }
}

// Wait for Knowledge Base to become active
async function waitForKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  const s = p.spinner();
  s.start('Waiting for Knowledge Base to become active...');
  
  const maxAttempts = 30;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const command = new GetKnowledgeBaseCommand({
        knowledgeBaseId: knowledgeBaseId,
      });
      
      const response = await bedrockAgentClient.send(command);
      const status = response.knowledgeBase?.status;
      
      if (status === 'ACTIVE') {
        s.stop(`Knowledge Base is ${color.green('ACTIVE')}`);
        return;
      } else if (status === 'FAILED') {
        s.stop('Knowledge Base creation failed', 1);
        throw new Error('Knowledge Base creation failed');
      }
      
      attempts++;
      s.message(`Status: ${color.yellow(status || 'UNKNOWN')} (${attempts}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      
    } catch (error: any) {
      if (attempts >= maxAttempts - 1) {
        s.stop('Timeout waiting for Knowledge Base', 1);
        throw error;
      }
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  s.stop('Timeout waiting for Knowledge Base to become active', 1);
  throw new Error('Timeout waiting for Knowledge Base to become active');
}

// Start ingestion job
async function startIngestionJob(
  knowledgeBaseId: string,
  dataSourceId: string
): Promise<void> {
  const s = p.spinner();
  s.start('Starting ingestion job');
  
  const command = new StartIngestionJobCommand({
    knowledgeBaseId: knowledgeBaseId,
    dataSourceId: dataSourceId,
    description: "Initial ingestion of documents from S3",
  });
  
  try {
    const response = await bedrockAgentClient.send(command);
    const jobId = response.ingestionJob!.ingestionJobId!;
    const status = response.ingestionJob!.status!;
    
    s.stop(`Ingestion job started: ${color.cyan(jobId)}`);
    p.log.info(`Status: ${color.dim(status)}`);
    p.note(
      `Upload documents to ${color.cyan(`s3://${CONFIG.s3BucketName}/`)} and run ingestion again to process them`,
      'Next step'
    );
  } catch (error: any) {
    s.stop('Failed to start ingestion', 1);
    p.log.error(error.message);
    throw error;
  }
}

// Main execution
async function main() {
  console.clear();
  
  p.intro(color.bgCyan(color.black(' AWS Bedrock Knowledge Base Setup ')));
  
  p.log.info(`Region: ${color.cyan(CONFIG.region)}`);
  p.log.info(`Documents Bucket: ${color.cyan(CONFIG.s3BucketName)}`);
  p.log.info(`Vectors Bucket: ${color.cyan(CONFIG.s3VectorsBucketName)}`);
  p.log.info(`Index Name: ${color.cyan(CONFIG.indexName)}`);
  p.log.info(`Knowledge Base: ${color.cyan(CONFIG.knowledgeBaseName)}`);
  p.log.info(`Embedding Model: ${color.cyan(CONFIG.embeddingModel)}`);
  p.log.info(`Role ARN: ${color.dim(CONFIG.roleArn || 'Not set')}`);
  
  // Validate required configuration
  if (!CONFIG.roleArn) {
    p.log.error('BEDROCK_KB_ROLE_ARN environment variable is required');
    p.outro(color.red('Setup aborted'));
    process.exit(1);
  }
  
  try {
    // Step 1: Create S3 bucket for documents
    const s3BucketName = await createDocumentsBucket(CONFIG.s3BucketName);
    
    // Step 2: Create S3 Vectors bucket for embeddings
    const vectorBucketArn = await createVectorsBucket(CONFIG.s3VectorsBucketName);
    
    // Step 3: Create index in S3 Vectors bucket
    const indexArn = await createVectorIndex(vectorBucketArn, CONFIG.indexName);
        
    // Step 4: Create Knowledge Base
    const knowledgeBaseId = await createKnowledgeBase(CONFIG.roleArn, vectorBucketArn, indexArn);
    
    // Step 5: Wait for Knowledge Base to be active
    await waitForKnowledgeBase(knowledgeBaseId);
    
    // Step 6: Create Data Source
    const dataSourceId = await createDataSource(knowledgeBaseId, s3BucketName);
    
    // Step 7: Upload local documents before initial ingestion
    await uploadDocuments(s3BucketName);

    // Step 8: Start initial ingestion job
    await startIngestionJob(knowledgeBaseId, dataSourceId);
    
    // Summary
    p.note(
      [
        `Knowledge Base ID: ${color.cyan(knowledgeBaseId)}`,
        `Data Source ID: ${color.cyan(dataSourceId)}`,
        `Documents Bucket: ${color.cyan(s3BucketName)}`,
        `Vectors Bucket ARN: ${color.dim(vectorBucketArn)}`,
        `Index ARN: ${color.dim(indexArn)}`,
        `IAM Role ARN: ${color.dim(CONFIG.roleArn)}`,
      ].join('\n'),
      'Resources Created'
    );
    
    p.note(
      [
        `1. Upload documents to: ${color.cyan(`s3://${s3BucketName}/`)}`,
        '2. Start ingestion job to process documents',
        '3. Query the knowledge base using Bedrock Agent Runtime API',
      ].join('\n'),
      'Next Steps'
    );
    
    p.outro(color.green('Setup completed successfully! \u2728'));
    
  } catch (error: any) {
    p.log.error(`Setup failed: ${error.message}`);
    p.outro(color.red('Setup failed'));
    process.exit(1);
  }
}

// Run the script
main();
