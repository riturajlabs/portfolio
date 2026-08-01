import logging

# Logger setup taaki actual error server par save ho, frontend par leak na ho
logger = logging.getLogger(__name__)

def get_ai_error_message(error: Exception | str) -> str:
    """
    Safely parses AI provider errors (Groq, Gemini, etc.) and returns 
    user-friendly messages without leaking sensitive backend details.
    """
    if not error:
        return "AI service is temporarily unavailable."

    error_text = str(error).lower()
    
    
    logger.error(f"AI Service Error: {str(error)}")

    # 1. API Key / Authentication Error (401, 403)
    if any(keyword in error_text for keyword in ["401", "403", "api key", "unauthorized"]):
        return "AI service configuration error. Please contact the administrator."

    # 2. Context Length / Token Limit (400, 413) - NEW ADDITION
    if any(keyword in error_text for keyword in ["400", "413", "context length", "too many tokens", "maximum context"]):
        return "Your message is too long for the AI to process. Please shorten it and try again."

    # 3. Rate Limit / Quota (429)
    if any(keyword in error_text for keyword in ["429", "rate limit", "quota", "too many requests"]):
        return "AI service is currently busy or out of capacity. Please try again in a few moments."

    # 4. Server Down / Timeout (500, 502, 503, 504)
    if any(keyword in error_text for keyword in ["500", "502", "503", "504", "server error", "timeout"]):
        return "AI provider is temporarily down. Please try again later."

    # 5. Default Fallback (SECURE)
   
    return "An unexpected error occurred while contacting the AI service. Please try again."