export function calculateGithubStatistics(repositories) {

    const stats = {

        totalStars:0,

        totalForks:0,

        totalRepositories:repositories.length,

        languages:{},

        mostUsedLanguage:"Not Available"

    };


    repositories.forEach((repo)=>{

        stats.totalStars += repo.stargazers_count;

        stats.totalForks += repo.forks_count;


        if(repo.language){

            stats.languages[repo.language] =

                (stats.languages[repo.language] || 0) + 1;

        }

    });


    let max = 0;


    Object.entries(stats.languages).forEach(([language,count])=>{

        if(count > max){

            max = count;

            stats.mostUsedLanguage = language;

        }

    });


    return stats;

}