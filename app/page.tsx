'use client';

import { FormEvent, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput as Input,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { MessageSquare } from 'lucide-react';

const EXAMPLE_SUGGESTIONS = [
  'What information is available in the knowledge base?',
  'Can you summarize the key points from the documents?',
  'Help me understand the main concepts',
];

export default function Chat() {
  const { messages, sendMessage, status } = useChat();

  const handleSubmit = (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (message.text.trim() && status !== 'streaming') {
      sendMessage({ text: message.text });
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (status !== 'streaming') {
      sendMessage({ text: suggestion });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-semibold">RAG Chat with S3 Vectors</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Powered by AWS Bedrock Knowledge Base and Vercel AI SDK
          </p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden">
        <div className="max-w-4xl mx-auto h-full px-6 py-6 flex flex-col">
          <Conversation className="flex-1">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  icon={<MessageSquare className="size-12" />}
                  title="Start a conversation"
                  description="Ask questions about your knowledge base or try one of the suggestions below"
                />
              ) : (
                messages.map((message) => (
                  <Message from={message.role} key={message.id}>
                    <MessageContent>
                      {message.parts.map((part, i) => {
                        switch (part.type) {
                          case 'text':
                            return (
                              <MessageResponse key={`${message.id}-${i}`}>
                                {part.text}
                              </MessageResponse>
                            );
                          case 'tool-getInformation':
                            return (
                              <Tool key={`${message.id}-${i}`}>
                                <ToolHeader
                                  title={part.title}
                                  type={part.type}
                                  state={part.state}
                                />
                                <ToolContent>
                                  {part.input ? <ToolInput input={part.input} /> : null}
                                  {(part.output || part.errorText) && (
                                    <ToolOutput
                                      output={part.output}
                                      errorText={part.errorText}
                                    />
                                  )}
                                </ToolContent>
                              </Tool>
                            );
                          default:
                            return null;
                        }
                      })}
                    </MessageContent>
                  </Message>
                ))
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Input */}
          <div className="mt-4">
            <Input
              onSubmit={handleSubmit}
              className="w-full relative"
            >
              <PromptInputTextarea
                placeholder="Ask me anything about your documents..."
                className="pr-12 resize-none"
                rows={1}
              />
              <PromptInputSubmit
                status={status === 'streaming' ? 'streaming' : 'ready'}
                disabled={status === 'streaming'}
                className="absolute bottom-2 right-2"
              />
            </Input>
          </div>
        </div>
      </div>
    </div>
  );
}
