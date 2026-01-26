# System Overview

## Objective
The system is a human–AI coordination layer and agent-native workflow engine for real-time execution and orchestration of knowledge work. It is designed for engineering teams to streamline software delivery processes.

## Requirements and Features

### Overall Requirements
1. **Requirement Ingestion**:
   - The system must capture and refine high-level requirements from external tools (e.g., GitHub Issues).
   - Ensure requirements are clear, actionable, and prioritized.

2. **Task Management**:
   - Break down requirements into smaller, manageable tasks.
   - Track task progress and dependencies.

3. **Code Generation**:
   - Automatically generate code snippets or scripts for tasks.
   - Ensure generated code aligns with predefined templates or AI models.

4. **Validation and Testing**:
   - Automate testing of generated code to ensure quality.
   - Validate outputs against acceptance criteria.

5. **Scheduling and Releases**:
   - Manage task priorities and coordinate releases.
   - Batch issues into releases, which can be configured as weekly or daily.
   - Ensure dependencies are resolved before execution.

6. **Agent Communication**:
   - Enable seamless communication between agents (Planning, Execution, Verification, Scheduling).
   - Use OpenCode for orchestration and workflow management.

7. **Notifications**:
   - Provide real-time updates on task progress and system status.
   - Integrate with external tools for notifications (e.g., GitHub Issues).

### Key Features
1. **Agent Workflows**:
   - **Planning Agents**: Refine requirements and create actionable tasks.
   - **Execution Agents**: Generate code snippets for tasks.
   - **Verification Agents**: Automate testing and validate outputs.
   - **Scheduling Agents**: Manage task priorities and release schedules.

2. **Integration with Tools**:
   - **GitHub Issues**: Task management.
   - **Playwright**: Automated testing.
   - **Woodpecker**: CI/CD and scheduling.

3. **Orchestration Framework**:
   - OpenCode for managing agent communication and workflows.

4. **State Machine Workflow**:
   - Structured states: Ingestion → Task Planning → Execution → Verification → Scheduling → Completion.
   - Iterative transitions for rework and validation.

## Guide for Collecting Product Details

### Step 1: Define High-Level Goals
- What is the primary objective of the product?
- Who are the target users, and what problems does the product solve for them?
- What are the key deliverables for the product?

### Step 2: Identify Core Features
- What are the must-have features for the product?
- Are there any specific workflows or processes that need to be automated?
- What integrations with external tools are required (e.g., GitHub, Playwright, Woodpecker)?

### Step 3: Break Down Requirements
- What are the high-level requirements for each feature?
- Can these requirements be broken into smaller, actionable tasks?
- What are the dependencies between tasks?

### Step 4: Define Acceptance Criteria
- What does success look like for each feature or task?
- Are there specific metrics or benchmarks to validate success?

### Step 5: Prioritize Tasks
- Which tasks or features are critical for the first iteration?
- What can be deferred to future iterations?

### Step 6: Create GitHub Issues
- Write clear and concise descriptions for each task.
- Include relevant details such as:
  - Objective
  - Steps to complete
  - Acceptance criteria
  - Dependencies
  - Flags and options for adjustments (e.g., priority, scope, dependencies).
- Assign tasks to the appropriate AI coding agents.

### Step 7: Clarification Stage
- After Planning Agents create the GitHub Issues, the system will:
  - Notify the product manager to review the issues.
  - Allow the product manager to request clarifications or adjustments.
  - Provide options to modify task details, such as:
    - Adjusting priorities.
    - Adding or removing dependencies.
    - Refining acceptance criteria.

### Step 8: Batch Issues into Releases
- Group tasks into releases based on:
  - Priority levels.
  - Dependencies.
  - Configurable release schedules (e.g., weekly or daily).
- Notify the product manager of the planned release schedule.
- Ensure all tasks in a release are validated and ready for execution.

### Step 9: Review and Refine
- Regularly review the GitHub Issues with the team.
- Refine tasks and priorities based on feedback and progress.

## Outcome
A backend system demonstrating:
- Task ingestion and refinement.
- Code generation.
- Automated testing.
- Scheduling and release management.