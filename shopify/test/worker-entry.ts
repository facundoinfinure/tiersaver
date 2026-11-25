export { SuppressionRunWorkflow } from "../workers/suppression-run";

export default {
  fetch() {
    return new Response("test worker");
  },
} satisfies ExportedHandler<Env>;
