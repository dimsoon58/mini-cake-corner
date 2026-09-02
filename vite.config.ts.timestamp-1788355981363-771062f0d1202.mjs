import "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
//#endregion
//#region vite.config.ts
const __vite_injected_original_dirname = "/sessions/rcw-01fnbgrxy9ndywrdpecvfpe3/mnt/mini-cake-corner";
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZS5jb25maWcuanMiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiL3Nlc3Npb25zL3Jjdy0wMWZuYmdyeHk5bmR5d3JkcGVjdmZwZTMvbW50L21pbmktY2FrZS1jb3JuZXIvdml0ZS5jb25maWcudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3Qtc3djXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgY29tcG9uZW50VGFnZ2VyIH0gZnJvbSBcImxvdmFibGUtdGFnZ2VyXCI7XG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiAoe1xuICBzZXJ2ZXI6IHtcbiAgICBob3N0OiBcIjo6XCIsXG4gICAgcG9ydDogODA4MCxcbiAgfSxcbiAgcGx1Z2luczogW3JlYWN0KCksIG1vZGUgPT09IFwiZGV2ZWxvcG1lbnRcIiAmJiBjb21wb25lbnRUYWdnZXIoKV0uZmlsdGVyKEJvb2xlYW4pLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpLFxuICAgIH0sXG4gIH0sXG59KSk7XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQSxNQUFNLG1DQUFtQztBQU16QyxJQUFBLHNCQUFlLGNBQWMsRUFBRSxZQUFZO0NBQ3pDLFFBQVE7RUFDTixNQUFNO0VBQ04sTUFBTTtDQUNSO0NBQ0EsU0FBUyxDQUFDLE1BQU0sR0FBRyxTQUFTLGlCQUFpQixnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsT0FBTyxPQUFPO0NBQzlFLFNBQVMsRUFDUCxPQUFPLEVBQ0wsS0FBSyxLQUFLLFFBQUEsa0NBQW1CLE9BQU8sRUFDdEMsRUFDRjtBQUNGLEVBQUUifQ==