import { Helmet } from "react-helmet-async";
import seo from "../../config/seo";


export default function SEO({

    title = seo.title,

    description = seo.description,

    keywords = seo.keywords,

    image = seo.image,

    imageAlt = seo.imageAlt,

    url = seo.url,

    robots = seo.robots,

    type = seo.type

}) {


    const keywordString =
        Array.isArray(keywords)
            ? keywords.join(", ")
            : keywords;


    const personId = `${seo.url}#person`;
    const websiteId = `${seo.url}#website`;


    // =========================================================
    // Structured Data — Schema.org @graph
    // Person + WebSite only, mirroring the static baseline in
    // index.html.
    //
    // Per-project SoftwareApplication entities are deliberately NOT
    // emitted here. Every project now has its own canonical page at
    // /projects/<slug>/ which declares the authoritative node, so a
    // second copy on the homepage would be a competing authority for
    // the same entity — one that had already drifted from the static
    // baseline and pointed `url` at the external demo host rather
    // than the portfolio page that actually describes it.
    // =========================================================

    const structuredData = {

        "@context": "https://schema.org",

        "@graph": [

            {

                "@type": "Person",

                "@id": personId,

                "name": seo.person.name,

                "alternateName": seo.person.alternateName,

                "url": seo.url,

                "image": seo.image,

                "jobTitle": seo.person.jobTitle,

                "description": seo.description,

                "email": `mailto:${seo.person.email}`,

                "address": {

                    "@type": "PostalAddress",

                    "addressLocality": seo.person.address.locality,

                    "addressRegion": seo.person.address.region,

                    "addressCountry": seo.person.address.country

                },

                "nationality": seo.person.nationality,

                "knowsAbout": seo.person.knowsAbout,

                "hasCredential": {

                    "@type": "EducationalOccupationalCredential",

                    "credentialCategory": "degree",

                    "name": seo.person.credential

                },

                "sameAs": seo.sameAs

            },

            {

                "@type": "WebSite",

                "@id": websiteId,

                "url": seo.url,

                "name": seo.siteName,

                "alternateName": seo.person.alternateName,

                "description": seo.description,

                "publisher": {

                    "@id": personId

                },

                "inLanguage": "en"

            }

        ]

    };



    return (

        <Helmet prioritizeSeoTags>


            {/* ========================= */}
            {/* Primary SEO */}
            {/* ========================= */}


            <title>
                {title}
            </title>


            <meta
                name="description"
                content={description}
            />


            <meta
                name="keywords"
                content={keywordString}
            />


            <meta
                name="author"
                content={seo.author}
            />


            <meta
                name="robots"
                content={robots}
            />


            <meta
                name="googlebot"
                content={robots}
            />


            <meta
                name="bingbot"
                content={robots}
            />


            <link
                rel="canonical"
                href={url}
            />



            {/* ========================= */}
            {/* Verification */}
            {/* ========================= */}


            {
                seo.verification.google &&
                <meta
                    name="google-site-verification"
                    content={seo.verification.google}
                />
            }


            {
                seo.verification.bing &&
                <meta
                    name="msvalidate.01"
                    content={seo.verification.bing}
                />
            }




            {/* ========================= */}
            {/* Open Graph */}
            {/* ========================= */}


            <meta
                property="og:type"
                content={type}
            />


            <meta
                property="og:site_name"
                content={seo.siteName}
            />


            <meta
                property="og:title"
                content={title}
            />


            <meta
                property="og:description"
                content={description}
            />


            <meta
                property="og:url"
                content={url}
            />


            <meta
                property="og:image"
                content={image}
            />


            <meta
                property="og:image:width"
                content="1200"
            />


            <meta
                property="og:image:height"
                content="630"
            />


            <meta
                property="og:image:alt"
                content={imageAlt}
            />


            <meta
                property="og:locale"
                content={seo.locale}
            />



            {/* ========================= */}
            {/* Twitter */}
            {/* ========================= */}


            <meta
                name="twitter:card"
                content={seo.twitterCard}
            />


            <meta
                name="twitter:site"
                content={seo.twitterSite}
            />


            <meta
                name="twitter:title"
                content={title}
            />


            <meta
                name="twitter:description"
                content={description}
            />


            <meta
                name="twitter:image"
                content={image}
            />


            <meta
                name="twitter:image:alt"
                content={imageAlt}
            />



            {/* ========================= */}
            {/* Structured Data */}
            {/* ========================= */}


            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(structuredData)
                }}
            />


        </Helmet>

    );

}
