import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "am-plataforma";
export default defineRailway(() => {
  const amPlataforma = service("am-plataforma", {
    source: github("montenegroabrantes-lang/am-plataforma", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "node src/index.js",
    healthcheck: "/health",
    healthcheckTimeout: 180,
    preDeploy: "node migrate.js",
    replicas: { "us-west2": 1 },
  });

  return project("am-plataforma", {
    variables: { managed: false },
    resources: [amPlataforma],
  });
});
