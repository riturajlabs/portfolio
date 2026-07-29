export function updateSEO({
    title,
    description,
    keywords
}){


    document.title = title;



    const descriptionTag =
        document.querySelector(
            'meta[name="description"]'
        );


    if(descriptionTag){

        descriptionTag.setAttribute(
            "content",
            description
        );

    }



    const keywordsTag =
        document.querySelector(
            'meta[name="keywords"]'
        );


    if(keywordsTag){

        keywordsTag.setAttribute(
            "content",
            keywords.join(", ")
        );

    }


}