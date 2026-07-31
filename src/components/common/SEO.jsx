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

    return (

        <Helmet prioritizeSeoTags>

            {/* Primary */}

            <title>{title}</title>

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

            {/* Open Graph */}

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
                property="og:locale"
                content={seo.locale}
            />

            {/* Twitter */}

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

        </Helmet>

    );

}