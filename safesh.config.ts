export default {
  // Use permissive preset - includes git, deno, docker, etc.
  preset: "permissive",
  permissions: {
    run: ["lsof", "ps", "netstat"],
  },
  external: {
    lsof: { allow: true },
    ps: { allow: true },
    netstat: { allow: true },
  },
};
