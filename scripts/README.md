# AWS Bedrock Knowledge Base Setup Script

This script automatically creates all necessary AWS resources for a Bedrock Knowledge Base using S3 Vectors for embeddings storage.

## Prerequisites

1. **AWS Credentials**: Configure your AWS credentials
   ```bash
   aws configure
   ```

2. **IAM Role**: Create an IAM role with permissions for:
   - S3 (GetObject, ListBucket on your documents bucket)
   - S3 Vectors (Query, GetVectorBucket, PutVector, DeleteVector)
   - Bedrock (InvokeModel for the embedding model)
   
   The role must have a trust policy allowing `bedrock.amazonaws.com` to assume it.

3. **Required Environment Variable**: Set `BEDROCK_KB_ROLE_ARN` with your IAM role ARN

4. **Node.js & TypeScript**: Ensure you have Node.js installed and TypeScript configured

## What This Script Creates

1. **S3 Bucket**: For storing source documents
2. **S3 Vectors Bucket**: For storing vector embeddings
3. **Knowledge Base**: Configured with Titan Embed Text v2 model (uses your provided IAM role)
4. **Data Source**: Connected to your S3 bucket
5. **Ingestion Job**: Initial job to process documents (if any exist)

## Usage

### Option 1: Using Default Configuration

```bash
npm run setup-kb
# or
npx tsx scripts/setup-knowledge-base.ts
```

### Option 2: Using Environment Variables

```bash
# Copy the example env file
cp .env.example .env

# Edit .env with your preferred values
nano .env

# Run the script
npm run setup-kb
```

### Option 3: Using Custom Environment Variables

```bash
BEDROCK_KB_ROLE_ARN=arn:aws:iam::123456789012:role/MyBedrockRole \
AWS_REGION=us-west-2 \
S3_BUCKET_NAME=my-docs-bucket \
S3_VECTORS_BUCKET_NAME=my-vectors-bucket \
KB_NAME=my-knowledge-base \
npx tsx scripts/setup-knowledge-base.ts
```

## IAM Role Requirements

The IAM role specified in `BEDROCK_KB_ROLE_ARN` must have:

**Trust Policy** (allow Bedrock to assume the role):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "bedrock.amazonaws.com"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "aws:SourceAccount": "YOUR_ACCOUNT_ID"
      }
    }
  }]
}
```

**Permissions Policy**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3vectors:Query",
        "s3vectors:GetVectorBucket",
        "s3vectors:PutVector",
        "s3vectors:DeleteVector"
      ],
      "Resource": "arn:aws:s3vectors:*:*:bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0"
    }
  ]
}
```

## Configuration Options

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BEDROCK_KB_ROLE_ARN` | IAM role ARN for Knowledge Base | - | **Yes** |
| `AWS_REGION` | AWS region for all resources | `us-east-1` | No |
| `S3_BUCKET_NAME` | Name for documents bucket | `kb-documents-{timestamp}` | No |
| `S3_VECTORS_BUCKET_NAME` | Name for vectors bucket | `kb-vectors-{timestamp}` | No |
| `KB_NAME` | Knowledge base name | `my-knowledge-base-{timestamp}` | No |
| `EMBEDDING_MODEL` | Bedrock embedding model | `amazon.titan-embed-text-v2:0` | No |

## After Setup

1. **Upload Documents**:
   ```bash
   aws s3 cp ./documents/ s3://YOUR-BUCKET-NAME/ --recursive
   ```

2. **Start Ingestion** (using AWS CLI):
   ```bash
   aws bedrock-agent start-ingestion-job \
     --knowledge-base-id YOUR-KB-ID \
     --data-source-id YOUR-DS-ID
   ```

3. **Query the Knowledge Base** (using Bedrock Agent Runtime):
   ```typescript
   import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
   
   const client = new BedrockAgentRuntimeClient({ region: "us-east-1" });
   const command = new RetrieveCommand({
     knowledgeBaseId: "YOUR-KB-ID",
     retrievalQuery: {
       text: "What is this about?"
     }
   });
   
   const response = await client.send(command);
   console.log(response.retrievalResults);
   ```

## Supported Embedding Models

- `amazon.titan-embed-text-v2:0` (1024 dimensions) - Default
- `amazon.titan-embed-text-v1` (1536 dimensions)
- `cohere.embed-english-v3` (1024 dimensions)
- `cohere.embed-multilingual-v3` (1024 dimensions)

## Troubleshooting

### "Access Denied" Errors
- Ensure your AWS credentials have the required permissions
- Check that IAM role propagation completed (script waits 10 seconds)

### "Bucket Already Exists"
- The script handles existing buckets gracefully
- Use unique bucket names or the default timestamp-based names

### "InvalidParameterException"
- Verify the embedding model is available in your region
- Check that S3 Vectors is available in your region

## Cost Considerations

- **S3**: Storage costs for documents
- **S3 Vectors**: Storage costs for embeddings
- **Bedrock**: Charges for embedding model usage during ingestion
- **Data Transfer**: Costs may apply for data transfer

## Cleanup

To delete all created resources:

```bash
# Delete Knowledge Base
aws bedrock-agent delete-knowledge-base --knowledge-base-id YOUR-KB-ID

# Delete S3 buckets (after emptying them)
aws s3 rb s3://YOUR-BUCKET-NAME --force
aws s3vectors delete-vector-bucket --bucket YOUR-VECTORS-BUCKET-NAME

# Delete IAM role and policy (via AWS Console or CLI)
```

## Example Output

```
🚀 Starting AWS Bedrock Knowledge Base Setup
============================================================
Region: us-east-1
Documents Bucket: kb-documents-1704556800000
Vectors Bucket: kb-vectors-1704556800000
Knowledge Base Name: my-knowledge-base-1704556800000
Embedding Model: amazon.titan-embed-text-v2:0
============================================================

📦 Creating S3 bucket for documents: kb-documents-1704556800000
✓ S3 bucket created: kb-documents-1704556800000
✓ S3 bucket is ready

🔢 Creating S3 Vectors bucket for embeddings: kb-vectors-1704556800000
✓ S3 Vectors bucket created: kb-vectors-1704556800000
  ARN: arn:aws:s3vectors:us-east-1:123456789012:bucket/kb-vectors-1704556800000

🔐 Creating IAM role for Bedrock Knowledge Base: BedrockKBRole-1704556800000
✓ IAM role created: arn:aws:iam::123456789012:role/BedrockKBRole-1704556800000
✓ IAM policy created: arn:aws:iam::123456789012:policy/BedrockKBPolicy-1704556800000
✓ Policy attached to role
⏳ Waiting for IAM role to propagate (10 seconds)...

🧠 Creating Bedrock Knowledge Base: my-knowledge-base-1704556800000
✓ Knowledge Base created: ABC123DEF456
  Name: my-knowledge-base-1704556800000
  ARN: arn:aws:bedrock:us-east-1:123456789012:knowledge-base/ABC123DEF456
  Status: CREATING

📁 Creating Data Source for S3 bucket
✓ Data Source created: GHI789JKL012
  Name: kb-documents-1704556800000-datasource
  Status: AVAILABLE

🔄 Starting ingestion job
✓ Ingestion job started: MNO345PQR678
  Status: STARTING
  Note: Upload documents to s3://kb-documents-1704556800000/ and run ingestion again to process them

============================================================
✅ Setup Complete!
============================================================

📝 Summary:
  Knowledge Base ID: ABC123DEF456
  Data Source ID: GHI789JKL012
  Documents Bucket: kb-documents-1704556800000
  Vectors Bucket ARN: arn:aws:s3vectors:us-east-1:123456789012:bucket/kb-vectors-1704556800000
  IAM Role ARN: arn:aws:iam::123456789012:role/BedrockKBRole-1704556800000

📤 Next Steps:
  1. Upload documents to: s3://kb-documents-1704556800000/
  2. Start ingestion job to process documents
  3. Query the knowledge base using the Bedrock Agent Runtime API
```
