"use client";

import { useState, useRef, useEffect } from "react";
import { 
  Send, 
  Paperclip, 
  Mic, 
  Image, 
  Video, 
  FileText,
  X,
  ChevronDown,
  Sparkles,
  Film
} from "lucide-react";

interface Reference {
  id: string;
  file: File;
  type: "product" | "character" | "location" | "visual style" | "other";
  preview: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  references?: Reference[];
  timestamp: Date;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "This project is empty. Step 1: share the idea and any references. I'll return only the core concept for approval—camera, shots and sound stay hidden until their turn.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [references, setReferences] = useState<Reference[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newReferences: Reference[] = files.map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      type: "other",
      preview: URL.createObjectURL(file),
    }));
    setReferences([...references, ...newReferences]);
  };

  const removeReference = (id: string) => {
    setReferences(references.filter((r) => r.id !== id));
  };

  const updateReferenceType = (id: string, type: Reference["type"]) => {
    setReferences(
      references.map((r) => (r.id === id ? { ...r, type } : r))
    );
  };

  const handleSend = async () => {
    if (!input.trim() && references.length === 0) return;

    const userMessage: Message = {
      id: Math.random().toString(36).substr(2, 9),
      role: "user",
      content: input,
      references: references.length > 0 ? references : undefined,
      timestamp: new Date(),
    };

    setMessages([...messages, userMessage]);
    setInput("");
    setReferences([]);
    setIsTyping(true);

    // Get API key from localStorage
    const apiKey = localStorage.getItem("openrouter_api_key");
    
    if (!apiKey) {
      const errorMessage: Message = {
        id: Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: "Please add your OpenRouter API key in Settings first. Click the Profile icon in the sidebar to access Settings.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setIsTyping(false);
      return;
    }

    // Build the conversation for the API
    const apiMessages = [
      {
        role: "system",
        content: `You are HAYK, a world-class creative director for NUMU AI Film Studio. You help users create cinematic, photorealistic, premium advertisements, films, and stories.

Your style:
- Professional, cinematic, premium tone
- Focus on photorealistic, live-action realism (no AI/CGI look)
- Collaborative but not overwhelming
- Keep secrets behind the scenes (don't reveal all production details at once)
- Guide users through the creative process step by step

When users share ideas and references:
1. Analyze what they've provided
2. Understand the concept, style, and key elements
3. Propose a creative direction
4. Wait for approval before proceeding to details

Always respond in a professional, cinematic tone. Use markdown formatting for clarity.`
      },
      ...messages.map((msg) => ({
        role: msg.role,
        content: msg.content
      })),
      {
        role: "user",
        content: input
      }
    ];

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey,
          messages: apiMessages,
          model: "anthropic/claude-3.5-sonnet"
        }),
      });

      const data = await response.json();

      if (data.error) {
        const errorMessage: Message = {
          id: Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: `Error: ${data.error}. Please check your API key in Settings.`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } else {
        const assistantMessage: Message = {
          id: Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: data.choices?.[0]?.message?.content || "No response generated.",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: "Failed to connect to the API. Please check your internet connection and API key.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }

    setIsTyping(false);
  };

  const quickActions = [
    "Create a perfume film",
    "Transform raw footage",
    "Continue a previous film",
  ];

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[#2a2a2a] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-lime-400 tracking-wider">CREATIVE ROOM</span>
            <span className="text-gray-600">·</span>
            <span className="text-xs text-gray-500">IDEA</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 text-xs bg-[#1a1a1a] rounded-full text-gray-400">
            Collaborative
          </span>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`animate-fade-in ${
                message.role === "assistant" ? "flex gap-4" : ""
              }`}
            >
              {message.role === "assistant" && (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-lime-400 to-green-600 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-black" />
                </div>
              )}
              
              <div
                className={`rounded-2xl p-5 ${
                  message.role === "assistant"
                    ? "bg-[#111] border border-[#2a2a2a]"
                    : "bg-[#1a1a1a]"
                }`}
              >
                {/* References */}
                {message.references && message.references.length > 0 && (
                  <div className="flex gap-3 mb-4 overflow-x-auto pb-2">
                    {message.references.map((ref) => (
                      <div
                        key={ref.id}
                        className="relative flex-shrink-0 w-32"
                      >
                        <div className="aspect-video bg-[#252525] rounded-lg overflow-hidden">
                          {ref.file.type.startsWith("image/") ? (
                            <img
                              src={ref.preview}
                              alt={ref.file.name}
                              className="w-full h-full object-cover"
                            />
                          ) : ref.file.type.startsWith("video/") ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <Video className="w-8 h-8 text-gray-500" />
                            </div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <FileText className="w-8 h-8 text-gray-500" />
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-2 truncate">
                          {ref.file.name}
                        </p>
                        <p className="text-xs text-lime-400 capitalize">
                          {ref.type}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Message Content */}
                <div className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {message.content}
                </div>
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex gap-4 animate-fade-in">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-lime-400 to-green-600 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-black" />
              </div>
              <div className="bg-[#111] border border-[#2a2a2a] rounded-2xl p-5">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-lime-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-lime-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-lime-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick Actions (only show if no messages besides initial) */}
      {messages.length === 1 && (
        <div className="px-6 pb-4">
          <div className="max-w-4xl mx-auto flex gap-3 justify-center">
            {quickActions.map((action) => (
              <button
                key={action}
                onClick={() => setInput(action)}
                className="px-4 py-2 bg-[#1a1a1a] hover:bg-[#252525] border border-[#2a2a2a] rounded-full text-sm text-gray-300 transition-colors"
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="px-6 pb-6">
        <div className="max-w-4xl mx-auto">
          {/* References Preview */}
          {references.length > 0 && (
            <div className="mb-4 p-4 bg-[#111] border border-[#2a2a2a] rounded-2xl">
              <div className="flex gap-4 overflow-x-auto pb-2">
                {references.map((ref) => (
                  <div key={ref.id} className="relative flex-shrink-0 w-40">
                    <div className="aspect-video bg-[#252525] rounded-lg overflow-hidden">
                      {ref.file.type.startsWith("image/") ? (
                        <img
                          src={ref.preview}
                          alt={ref.file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : ref.file.type.startsWith("video/") ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <Video className="w-10 h-10 text-gray-500" />
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <FileText className="w-10 h-10 text-gray-500" />
                        </div>
                      )}
                    </div>
                    
                    {/* Reference Type Selector */}
                    <select
                      value={ref.type}
                      onChange={(e) => updateReferenceType(ref.id, e.target.value as Reference["type"])}
                      className="mt-2 w-full px-2 py-1 text-xs bg-[#252525] border border-[#333] rounded text-gray-300 focus:outline-none focus:border-lime-500"
                    >
                      <option value="product">Product</option>
                      <option value="character">Character</option>
                      <option value="location">Location</option>
                      <option value="visual style">Visual style</option>
                      <option value="other">Other</option>
                    </select>
                    
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {ref.file.name}
                    </p>
                    
                    {/* Remove Button */}
                    <button
                      onClick={() => removeReference(ref.id)}
                      className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input Box */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded-2xl p-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Share the idea—or paste a link, image, video, product page, music or raw footage..."
              className="w-full bg-transparent text-gray-300 placeholder-gray-600 resize-none focus:outline-none min-h-[60px]"
              rows={2}
            />
            
            {/* Bottom Actions */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#2a2a2a]">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 hover:bg-[#252525] rounded-lg transition-colors"
                >
                  <Paperclip className="w-5 h-5 text-lime-400" />
                </button>
                <button
                  onClick={() => setIsRecording(!isRecording)}
                  className={`p-2 rounded-lg transition-colors ${
                    isRecording ? "bg-red-500/20 text-red-400" : "hover:bg-[#252525] text-gray-500"
                  }`}
                >
                  <Mic className="w-5 h-5" />
                </button>
                <span className="text-xs text-gray-600">
                  Drop, paste or record · long references are sampled locally first
                </span>
              </div>
              
              <button
                onClick={handleSend}
                disabled={!input.trim() && references.length === 0}
                className="p-3 bg-lime-500 hover:bg-lime-400 disabled:bg-[#252525] disabled:text-gray-600 rounded-xl transition-colors"
              >
                <Send className="w-5 h-5 text-black" />
              </button>
            </div>
          </div>
          
          <p className="text-center text-xs text-gray-600 mt-3">
            Reference mapping happens on your device. No paid production starts from this composer.
          </p>
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,.pdf,.doc,.docx"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
