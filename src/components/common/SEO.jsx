import { Helmet } from "react-helmet-async";
import seo from "../../config/seo";


export default function SEO({

    title = seo.title,

    description = seo.description,

    keywords = seo.keywords,

    image = seo.image,

    url = seo.url,

    robots = seo.robots,

    type = seo.type

}) {


    const keywordString =
        Array.isArray(keywords)
            ? keywords.join(", ")
            : keywords;



    const structuredData = {

        "@context": "https://schema.org",

        "@type": "Person",

        "name": seo.person.name,

        "alternateName": seo.person.alternateName,

        "url": seo.url,

        "image": seo.image,

        "jobTitle": seo.person.jobTitle,

        "description": seo.description,


        "sameAs": [

            "https://github.com/riturajlabs",

            "https://linkedin.com/in/riturajlabs"

        ],


        "knowsAbout": seo.person.knowsAbout

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



            {/* ========================= */}
            {/* Twitter */}
            {/* ========================= */}


            <meta
                name="twitter:card"
                content={seo.twitterCard}
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