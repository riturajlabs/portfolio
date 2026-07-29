import emailjs from "@emailjs/browser";


export async function sendEmail(formData) {

    const response = await emailjs.send(

        import.meta.env.VITE_EMAIL_SERVICE_ID,

        import.meta.env.VITE_EMAIL_TEMPLATE_ID,

        {
            name: formData.name,

            email: formData.email,

            message: formData.message,
        },

        import.meta.env.VITE_EMAIL_PUBLIC_KEY

    );


    return response;

}