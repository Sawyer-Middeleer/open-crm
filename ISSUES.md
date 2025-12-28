# Agent CRM - Code Review Issues

This document contains all issues identified during a comprehensive code review prior to open source release.

## Issues

### 1. ~~No Authorization Checks in Queries/Mutations~~ ✅ FIXED

### 2. ~~Actor ID Not Validated Against Workspace~~ ✅ FIXED

### 3. ~~SSRF Bypass via Template Variables~~ ✅ FIXED

### 4. ~~SSRF Bypass via IPv6 and Missing Hosts~~ ✅ FIXED

### 5. ~~Weak Random Number Generator for API Keys~~ ✅ NO LONGER RELEVANT

### 6. ~~API Key Expiration Not Enforced~~ ✅ NO LONGER RELEVANT

### 7. ~~Timing Attack on API Key Hash Comparison~~ ✅ NO LONGER RELEVANT

### 8. ~~Missing `addedBy` Field in Action List Entries~~ ✅ FIXED

### 9. ~~No Scope Enforcement in MCP Server~~ ✅ FIXED

### 10. ~~Search Function Loads All Records Into Memory~~ ✅ FIXED

### 11. ~~Cursor-Based Pagination Not Implemented~~ ✅ FIXED

### 12. ~~Session Fixation/Hijacking Risk~~ ✅ FIXED

### 13. ~~No Rate Limiting~~ ✅ FIXED

### 14. ~~Race Condition on Slug Uniqueness~~ ✅ FIXED

### 15. ~~Dockerfile References Wrong Lock File~~ ✅ FIXED

### 16. ~~Missing `baseUrl` in tsconfig.json~~ ✅ FIXED

### 17. ~~Type Coercion Vulnerabilities~~ ✅ FIXED

## Medium Severity Issues

### 18. ~~Missing Audit Logging for Security Operations~~ ✅ FIXED

### 19. ~~Information Disclosure in Error Messages~~ ✅ FIXED

### 20. ~~No `.env.example` File~~ ✅ FIXED

### 21. ~~No LICENSE File~~ ✅ FIXED

### 22. ~~Duplicate Dependencies~~ ✅ FIXED

### 23. ~~Docker Container Runs as Root~~ ✅ FIXED

### 24. ~~Extensive Use of `v.any()` in Schema~~ ⚠️ NO NEED TO FIX

### 25. ~~No Recursion Limit on Nested Loops~~ ✅ FIXED

### 26. ~~Hardcoded Fallback URL~~ ✅ FIXED

### 27. ~~CORS Credentials with Broad Origins~~ ✅ FIXED

### 28. ~~Missing Validation for List Entry Object Types~~ ✅ FIXED

### 29. ~~HTTP Template URL Allows Internal URLs (SSRF)~~ ✅ FIXED

### 30. ~~No Validation of Cron Schedule Format~~ ✅ FIXED
