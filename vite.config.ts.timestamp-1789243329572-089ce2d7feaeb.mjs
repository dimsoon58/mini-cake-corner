import "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
//#endregion
//#region vite.config.ts
const __vite_injected_original_dirname = "/sessions/rcw-01snvwgp6uz9rra8rfdsph4f/mnt/eli--Desktop--mini-cake-corner";
var vite_config_default = defineConfig(({ mode }) => ({
	server: {
		host: "::",
		port: 8080
	},
	plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
	resolve: { alias: { "@": path.resolve(__vite_injected_original_dirname, "./src") } }
}));
//#endregion
export { vite_config_default as default };

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZS5jb25maWcuanMiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiL3Nlc3Npb25zL3Jjdy0wMXNudndncDZ1ejlycmE4cmZkc3BoNGYvbW50L2VsaS0tRGVza3RvcC0tbWluaS1jYWtlLWNvcm5lci92aXRlLmNvbmZpZy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6IFwiOjpcIixcbiAgICBwb3J0OiA4MDgwLFxuICB9LFxuICBwbHVnaW5zOiBbcmVhY3QoKSwgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpXS5maWx0ZXIoQm9vbGVhbiksXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgfSxcbiAgfSxcbn0pKTtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBLE1BQU0sbUNBQW1DO0FBTXpDLElBQUEsc0JBQWUsY0FBYyxFQUFFLFlBQVk7Q0FDekMsUUFBUTtFQUNOLE1BQU07RUFDTixNQUFNO0NBQ1I7Q0FDQSxTQUFTLENBQUMsTUFBTSxHQUFHLFNBQVMsaUJBQWlCLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxPQUFPLE9BQU87Q0FDOUUsU0FBUyxFQUNQLE9BQU8sRUFDTCxLQUFLLEtBQUssUUFBQSxrQ0FBbUIsT0FBTyxFQUN0QyxFQUNGO0FBQ0YsRUFBRSJ9