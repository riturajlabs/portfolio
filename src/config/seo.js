// =========================================================
// 🌐 SEO CONFIGURATION
// Used by:
// - React Helmet
// - Open Graph
// - Twitter Cards
// - Search Engines
// NOTE: Values here MUST match the static baseline tags in
// index.html (they carry data-rh="true" so React Helmet adopts
// them without creating duplicates).
// =========================================================

const seo = {

    // =====================================================
    // Website Identity
    // =====================================================

    siteName:
        "Ritu Raj Portfolio",


    title:
        "Ritu Raj | Full Stack Developer | MERN Stack & AI/ML Student",


    description:
        "Portfolio of Ritu Raj (RituRajLabs), Full Stack Developer & AI/ML Student. MERN Stack: React, Node.js, Express, MongoDB. Open to Software Developer Internship.",



    // =====================================================
    // SEO Keywords
    // =====================================================

    keywords: [

        "Ritu Raj",

        "RituRajLabs",

        "Ritu Raj Portfolio",

        "Full Stack Developer",

        "MERN Stack Developer",

        "React Developer",

        "Node.js Developer",

        "Express.js Developer",

        "MongoDB Developer",

        "JavaScript Developer",

        "Backend Developer",

        "Frontend Developer",

        "Software Developer",

        "Software Engineer",

        "Software Developer Internship",

        "AI ML Student",

        "Artificial Intelligence",

        "Machine Learning",

        "Generative AI",

        "Java Developer",

        "Python Developer",

        "Web Developer",

        "Developer Portfolio"

    ],



    // =====================================================
    // Author
    // =====================================================

    author:
        "Ritu Raj",



    // =====================================================
    // URLs
    // =====================================================

    url:
        "https://riturajlabs.vercel.app/",


    image:
        "https://riturajlabs.vercel.app/images/portfolio-og.jpg",


    imageAlt:
        "Ritu Raj - Full Stack Developer & AI/ML Student portfolio",



    // =====================================================
    // Social Preview
    // =====================================================

    twitterCard:
        "summary_large_image",


    twitterSite:
        "@riturajlabs",



    locale:
        "en_US",


    type:
        "website",



    // =====================================================
    // Search Engine Rules
    // =====================================================

    robots:
        "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",



    // =====================================================
    // Search Console Verification
    // File-based verification is already deployed
    // (googlea403830185afcdb8.html + BingSiteAuth.xml) and the
    // corresponding <meta> tags are static in index.html, so this
    // stays empty to avoid duplicate tags at runtime.
    // =====================================================

    verification: {

        google:
            "",

        bing:
            ""

    },


    // =====================================================
    // Structured Data Information
    // =====================================================

    person: {

        name:
            "Ritu Raj",

        alternateName:
            "RituRajLabs",

        jobTitle:
            "Full Stack Developer & AI/ML Student",

        email:
            "riturajlabs@outlook.com",

        address: {
            locality: "Pune",
            region: "Maharashtra",
            country: "IN"
        },

        nationality:
            "India",

        credential:
            "B.Sc. Artificial Intelligence & Machine Learning",

        knowsAbout: [

            "React.js",

            "JavaScript",

            "HTML & CSS",

            "Bootstrap",

            "Node.js",

            "Express.js",

            "FastAPI",

            "REST APIs",

            "Python",

            "Machine Learning",

            "PyTorch",

            "LangChain",

            "MongoDB",

            "PostgreSQL",

            "Git & GitHub",

            "Linux"

        ]

    },

    sameAs: [

        "https://github.com/riturajlabs",

        "https://linkedin.com/in/riturajlabs"

    ]

};


export default seo;
