export const markSkynexPrompt = (event: { metadata: Record<string, unknown> }) => {
  event.metadata = { ...event.metadata, skynex: true };
};
