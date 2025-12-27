export default {
  // Use permissive preset - includes git, deno, docker, etc.
  preset: "permissive",
  permissions: {
    run: [
      // Process/system inspection
      "ps", "lsof", "netstat", "ss", "pgrep", "pidof", "fuser",
      "top", "htop", "uptime", "uname", "hostname", "whoami", "id", "groups",

      // File/directory inspection
      "ls", "file", "stat", "du", "df", "find", "locate", "tree",
      "which", "whereis", "type", "realpath", "dirname", "basename",

      // Text processing
      "awk", "sed", "tr", "column", "comm", "join", "paste", "xargs",
      "jq", "yq", "xmllint",

      // Encoding/hashing
      "md5", "md5sum", "shasum", "sha256sum", "base64", "xxd", "od", "hexdump",

      // Compression (read)
      "zcat", "bzcat", "xzcat", "gzip", "gunzip", "tar", "unzip", "zipinfo",

      // Network inspection
      "ping", "host", "dig", "nslookup", "traceroute", "ifconfig", "ip", "arp", "route",
      "curl", "wget",

      // Date/time
      "date", "cal",

      // Misc
      "env", "printenv", "echo", "printf", "tee", "timeout", "time",
    ],
  },
  external: {
    // All inspection commands - allow without restrictions
    ps: { allow: true },
    lsof: { allow: true },
    netstat: { allow: true },
    ss: { allow: true },
    pgrep: { allow: true },
    pidof: { allow: true },
    fuser: { allow: true },
    top: { allow: true },
    htop: { allow: true },
    uptime: { allow: true },
    uname: { allow: true },
    hostname: { allow: true },
    whoami: { allow: true },
    id: { allow: true },
    groups: { allow: true },

    // File inspection
    ls: { allow: true },
    file: { allow: true },
    stat: { allow: true },
    du: { allow: true },
    df: { allow: true },
    find: { allow: true },
    locate: { allow: true },
    tree: { allow: true },
    which: { allow: true },
    whereis: { allow: true },
    type: { allow: true },
    realpath: { allow: true },
    dirname: { allow: true },
    basename: { allow: true },

    // Text processing
    awk: { allow: true },
    sed: { allow: true },
    tr: { allow: true },
    column: { allow: true },
    comm: { allow: true },
    join: { allow: true },
    paste: { allow: true },
    xargs: { allow: true },
    jq: { allow: true },
    yq: { allow: true },
    xmllint: { allow: true },

    // Encoding
    md5: { allow: true },
    md5sum: { allow: true },
    shasum: { allow: true },
    sha256sum: { allow: true },
    base64: { allow: true },
    xxd: { allow: true },
    od: { allow: true },
    hexdump: { allow: true },

    // Compression
    zcat: { allow: true },
    bzcat: { allow: true },
    xzcat: { allow: true },
    gzip: { allow: true },
    gunzip: { allow: true },
    tar: { allow: true },
    unzip: { allow: true },
    zipinfo: { allow: true },

    // Network
    ping: { allow: true },
    host: { allow: true },
    dig: { allow: true },
    nslookup: { allow: true },
    traceroute: { allow: true },
    ifconfig: { allow: true },
    ip: { allow: true },
    arp: { allow: true },
    route: { allow: true },
    curl: { allow: true },
    wget: { allow: true },

    // Misc
    date: { allow: true },
    cal: { allow: true },
    env: { allow: true },
    printenv: { allow: true },
    echo: { allow: true },
    printf: { allow: true },
    tee: { allow: true },
    timeout: { allow: true },
    time: { allow: true },
  },
};
