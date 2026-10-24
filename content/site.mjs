import { readFileSync } from "node:fs";

export const site = {
  name: "JamePeng",
  title: "JamePeng · 技术笔记与开源记录",
  url: "https://jamepeng.github.io",
  description:
    "JamePeng 的个人博客，记录模拟器与逆向、系统工具、本地推理，以及开源项目的维护过程。",
  github: "https://github.com/JamePeng",
};

// The local editor maintains this catalog. Public builds still require no server.
export const posts = JSON.parse(
  readFileSync(new URL("./posts.json", import.meta.url), "utf8"),
);
