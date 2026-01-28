/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'i.pinimg.com',
      },
      {
        protocol: 'https',
        hostname: '*.bp.blogspot.com',
      },
      {
        protocol: 'https',
        hostname: '*.staticflickr.com',
      },
      {
        protocol: 'https',
        hostname: 'thehoneycombers.com',
      },
      {
        protocol: 'https',
        hostname: 'danielfooddiary.com',
      },
      {
        protocol: 'https',
        hostname: 'cache-wak-wak-hawker-com.s3-ap-southeast-1.amazonaws.com',
      },
    ],
  },
};

export default nextConfig;
