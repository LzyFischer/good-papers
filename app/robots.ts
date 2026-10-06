import type { MetadataRoute } from "next";

// Author, institution, area and search pages list thousands of OpenAlex papers;
// a crawler following them would trigger an AI-panel judgment for each one.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/author/", "/org/", "/area/", "/ask", "/search", "/api/"] },
  };
}
