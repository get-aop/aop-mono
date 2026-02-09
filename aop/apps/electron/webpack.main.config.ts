import path from "path";
import type { Configuration } from "webpack";

export const mainConfig: Configuration = {
  entry: "./src/main.ts",
  target: "electron-main",
  mode: "production",
  module: {
    rules: [
      {
        test: /\.ts$/,
        include: /src/,
        use: {
          loader: "ts-loader",
          options: {
            configFile: path.resolve(__dirname, "tsconfig.json"),
            transpileOnly: true,
          },
        },
      },
    ],
  },
  output: {
    path: path.join(__dirname, ".webpack"),
    filename: "main",
    library: {
      type: "commonjs2",
    },
  },
  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    fullySpecified: false,
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};
