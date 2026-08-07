import { NextResponse } from "next/server";


export const config = {
    matcher: [
        "/api/chat/:path*",
        "/api/contact",
    ],
};



export default function middleware(request) {


    const apiKey = process.env.BACKEND_API_KEY;


    if (!apiKey) {

        return new NextResponse(
            JSON.stringify({
                error: "Missing BACKEND_API_KEY"
            }),
            {
                status: 503,
                headers:{
                    "content-type":"application/json"
                }
            }
        );

    }



    const headers = new Headers(
        request.headers
    );


    headers.set(
        "X-API-Key",
        apiKey
    );



    const response = NextResponse.next();


    Object.entries(headers).forEach(
        ([key,value])=>{
            response.headers.set(
                key,
                value
            );
        }
    );


    return response;

}