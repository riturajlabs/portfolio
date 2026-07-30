import { Helmet } from "react-helmet-async";

import seo from "../../config/seo";

export default function SEO({

    title = seo.title,

    description = seo.description,

    keywords = seo.keywords,

    image = seo.image,

    url = seo.url,

    robots = seo.robots

}) {

    const keywordString =

        Array.isArray(keywords)

            ? keywords.join(", ")

            : keywords;

    return (

        <Helmet>

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

            <link

                rel="canonical"

                href={url}

            />

            {/* Open Graph */}

            <meta

                property="og:type"

                content="website"

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

                property="og:image"

                content={image}

            />

            <meta

                property="og:url"

                content={url}

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