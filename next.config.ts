import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@vercel/oidc", "ajv"],
};

export default withWorkflow(nextConfig);
