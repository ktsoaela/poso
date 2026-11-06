import net from "node:net";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

export default defineConfig({
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  plugins: [
    react(),
    {
      name: "ipv6-localhost",
      configureServer(server) {
        // Windows often resolves localhost to ::1 while Vite is on 127.0.0.1, or the reverse.
        const bridge = net.createServer((socket) => {
          const upstream = net.connect({ host: "127.0.0.1", port: 1420 });
          socket.pipe(upstream);
          upstream.pipe(socket);
          const close = () => {
            socket.destroy();
            upstream.destroy();
          };
          socket.on("error", close);
          upstream.on("error", close);
        });
        bridge.listen(1420, "::1");
        server.httpServer?.on("close", () => bridge.close());
      },
    },
  ],
  envPrefix: ["VITE_"],
});
