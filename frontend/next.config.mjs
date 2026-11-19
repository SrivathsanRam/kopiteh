import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Shared DTOs must be visible during compilation, but have no runtime files.
    // Keep the standalone output rooted here for the App Hosting adapter.
    output: 'standalone',
    outputFileTracingRoot: __dirname,
};

export default nextConfig;
