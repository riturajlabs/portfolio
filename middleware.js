import { NextResponse } from "next/server";


const PROTECTED_PATHS = [
    "/api/chat",
    "/api/contact",
];


export const config = {
    matcher: [
        "/api/chat/:path*",
        "/api/contact",
    ],
};



export default function middleware(request) {

    const pathname = request.nextUrl.pathname;


    const needsKey = PROTECTED_PATHS.some(
        (path) => pathname.startsWith(path)
    );


    // Public routes
    if (!needsKey) {
        return NextResponse.next();
    }


    const apiKey = process.env.BACKEND_API_KEY;


    // Production safety
    if (!apiKey) {

        return new NextResponse(
            JSON.stringify({
                error: "API key not configured on proxy"
            }),
            {
                status: 503,
                headers: {
                    "content-type": "application/json",
                },
            }
        );
    }



    const requestHeaders = new Headers(
        request.headers
    );


    requestHeaders.set(
        "X-API-Key",
        apiKey
    );



    return NextResponse.next({

        request: {
            headers: requestHeaders,
        },

    });

}