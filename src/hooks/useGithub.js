import { useEffect, useState } from "react";

import {
    getGithubData,
    getContributionStatus,
} from "../services/githubService";


function useGithub() {

    const [data, setData] = useState({
        profile: null,
        repositories: [],
        stats: [],
    });

    const [loading, setLoading] = useState(true);

    const [error, setError] = useState("");


    useEffect(() => {

        async function loadGithubData() {

            try {

                const {
                    profile,
                    repositories,
                } = await getGithubData();


                setData({

                    profile,

                    repositories,

                    stats: [

                        {
                            title:"Repositories",

                            value:`${profile.public_repos}+`,

                            description:
                            "Projects & Experiments",
                        },


                        {
                            title:"Followers",

                            value:`${profile.followers}+`,

                            description:
                            "Developer Network",
                        },


                        {
                            title:"Following",

                            value:`${profile.following}+`,

                            description:
                            "Community Connections",
                        },


                        {
                            title:"Contribution",

                            value:
                            getContributionStatus(
                                repositories
                            ),

                            description:
                            "Learning & Building",
                        }

                    ]

                });


            } catch(error) {

                setError(
                    error.message ||
                    "Unable to fetch Github data."
                );

            }
            finally {

                setLoading(false);

            }

        }


        loadGithubData();


    }, []);



    return {

        ...data,

        loading,

        error,

    };

}


export default useGithub;