import path from "path";
import type { Configuration } from "webpack";

export const rendererConfig: Configuration = {
  target: "electron-renderer",
  mode: "development",
  module: {
    rules: [
      {
        test: /\.ts$/,
        include: /src/,
        use: {
          loader: "ts-loader",
          options: {
            configFile: path.resolve(__dirname, "tsconfig.json"),
          },
        },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  output: {
    path: path.join(__dirname, ".webpack", "renderer"),
    filename: "renderer.js",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
};
