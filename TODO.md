TODO 
-------------INSTRUCTIONS-----------------------
- for this file, NEVER remove these few lines of instructions at the top, never write progress updates in this file. ; for finished TODOs, no need to generate a md file with progress update everytime.. KEEP THE ADDED TESTS IF STILL USEFUL
- FOR ALL CHANGES:
    - please first see if a related test already exists for this, and if its passing already or failing, if not, add a test for it -- dont be lazy
    - implement the change or fix the bug and MAKE SURE the corresponding tests pass, if not, keep fixing it until its passed.
------------------------------------------------


- sometimes the generation doesnt work simply cuz user didnt put an API key, so the content page just says "preparing your course" without moving at all -- this misleads the user, it should tell user to fill in key in setting; also if when user started the course and it got moved to continue already but generation failed, when user clicks continue it stays on "preparing your course" and just stays tehre and doesnt trigger generate again even when user has the api key now.. -- fix this rigourously