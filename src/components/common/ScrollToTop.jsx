import { useEffect } from "react";


function ScrollToTop(){

    useEffect(()=>{

        const handleScroll = () => {

            if(window.scrollY === 0){
                return;
            }

        };


        window.addEventListener(
            "scroll",
            handleScroll
        );


        return ()=>{

            window.removeEventListener(
                "scroll",
                handleScroll
            );

        };


    },[]);


    return null;

}


export default ScrollToTop;