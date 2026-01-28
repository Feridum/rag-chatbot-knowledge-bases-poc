import {
    BedrockRuntimeClient,
    InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
    S3VectorsClient,
    QueryVectorsCommand as QueryCommand,
} from "@aws-sdk/client-s3vectors";
import { streamText, convertToModelMessages, UIMessage, tool, stepCountIs } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// Initialize AWS clients
const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
});

const s3VectorsClient = new S3VectorsClient({
    region: process.env.AWS_REGION || "us-east-1",
});

// Generate embeddings for a query using Bedrock
async function generateEmbedding(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
        modelId: process.env.EMBEDDING_MODEL || "amazon.titan-embed-text-v2:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            inputText: text,
        }),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.embedding;
}

// Query S3 Vectors directly for similar documents
async function findRelevantContent(question: string): Promise<string> {
    const indexArn = process.env.S3_VECTORS_INDEX_ARN;

    if (!indexArn) {
        console.warn("S3 Vectors configuration missing, skipping RAG");
        return "";
    }

    try {
        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(question);

        // Query S3 Vectors for similar documents
        const queryCommand = new QueryCommand({
            indexArn: indexArn,
            queryVector: {
              float32: queryEmbedding,
            },
            topK: 5, // Number of results to retrieve
            returnMetadata: true,
            returnDistance: true,
        });

        const queryResponse = await s3VectorsClient.send(queryCommand);
        const results = queryResponse.vectors || [];

        const content = results.map(result => result.metadata?.AMAZON_BEDROCK_TEXT || "").join("\n\n---\n\n");

        return content;
    } catch (error) {
        console.error("Error retrieving context from S3 Vectors:", error);
        return "";
    }
}

export async function POST(req: Request) {
    try {
        const { messages }: { messages: UIMessage[] } = await req.json();

        // Convert UI messages to model messages
        const modelMessages = await convertToModelMessages(messages);

        // Use Bedrock's Claude model for generation with tools
        const result = streamText({
            model: bedrock("eu.amazon.nova-2-lite-v1:0"),
            messages: modelMessages,
            system: `You are a helpful assistant. Check your knowledge base before answering any questions.
    Only respond to questions using information from tool calls.
    if no relevant information is found in the tool calls, respond, "Sorry, I don't know."`,
            tools: {
                getInformation: tool({
                    description: `get information from your knowledge base to answer questions.`,
                    inputSchema: z.object({
                        question: z.string().describe('the users question'),
                    }),
                    execute: async ({ question }) => findRelevantContent(question),
                }),
            },
            stopWhen: stepCountIs(5),
        });

        return result.toUIMessageStreamResponse();
    } catch (error) {
        console.error("Error in chat API:", error);
        return new Response(
            JSON.stringify({
                error: "Failed to process chat request",
                details: error instanceof Error ? error.message : String(error),
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}
