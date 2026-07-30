import { useEffect } from "react";

import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";
import ScrollToTop from "./components/common/ScrollToTop";

import Home from "./pages/Home";

import profile from "./data/profile";

import { updateSEO } from "./utils/seo";
import ChatAssistant from "./components/common/ChatAssistant";


function App(){


    useEffect(()=>{


        updateSEO(
            profile.seo
        );


    },[]);



    return(

        <>

            <ScrollToTop />


            <Navbar />


            <main>

                <Home />

            </main>


            <Footer />

            <ChatAssistant />


        </>

    );

}


export default App;