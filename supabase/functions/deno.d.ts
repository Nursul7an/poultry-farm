// Minimal Deno globals for typechecking the edge functions with tsc (the real runtime provides them).
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
