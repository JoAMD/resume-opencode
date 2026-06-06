declare module '@opencode-ai/sdk' {
  export function createOpencode(options?: {
    baseUrl?: string;
    autoStartServer?: boolean;
    serverTimeout?: number;
    defaultSettings?: {
      agent?: string;
      model?: string;
      [key: string]: any;
    };
  }): {
    generateText(prompt: string, options?: object): Promise<{ text: string }>;
  };
}