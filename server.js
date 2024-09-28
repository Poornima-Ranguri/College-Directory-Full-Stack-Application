const express = require("express");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");

const cors = require("cors");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const { request } = require("http");

const databasePath = path.join(__dirname, "collegeData.db");

const app = express();

app.use(express.json());

// Enable CORS for all routes
app.use(cors());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3003, () =>
      console.log("Server Running at http://localhost:3003/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const validatePassword = (password) => {
  return password.length > 4;
};

//Login

app.post("/login", async (request, response) => {
  const { username, password, role } = request.body;

  const selectUserQuery = `SELECT * FROM User WHERE username='${username}';`;
  const dbUser = await database.get(selectUserQuery);
  console.log(dbUser);

  if (dbUser === undefined) {
    response.status(400);
    response.status("Invalid User");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);

    if (isPasswordMatched === true) {
      response.status(200);
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({
        jwtToken,
        user_id: dbUser.id,
        username: dbUser.username,
        role: dbUser.role,
      });
    } else {
      response.status(400);
      response.send("Invalid Password");
    }
  }
});

//For Registering
app.post("/register", async (request, response) => {
  const { username, password, role, name, email, phone } = request.body;
  const saltRounds = 10;

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const selectUserQuery = `SELECT * FROM User WHERE username='${username}';`;
    const dbUser = await database.get(selectUserQuery);

    if (dbUser === undefined) {
      const createUserQuery = `INSERT INTO User (username, password, role, name, email, phone) VALUES ('${username}', '${hashedPassword}', '${role}', '${name}', '${email}', '${phone}');`;
      await database.run(createUserQuery);

      response.status(201).send("User created successfully");
    } else {
      response.status(400).send("User already exists");
    }
  } catch (error) {
    console.error("Error during registration:", error);
    response.status(500).send("Internal Server Error");
  }
});

// Fetch Student Profile
app.get("/students/profile", async (request, response) => {
  const { username } = request.query; // Assuming username is passed as query
  const selectStudentQuery = `
    SELECT u.id, u.name, u.email, u.phone, sp.photo, sp.year 
    FROM User u 
    JOIN StudentProfile sp ON u.id = sp.user_id 
    WHERE u.username = ?;`;

  const studentProfile = await database.get(selectStudentQuery, [username]);

  if (studentProfile) {
    response.status(200).send(studentProfile);
  } else {
    response.status(404).send("Student not found");
  }
});

// Search for Other Students
app.get("/students/search", async (request, response) => {
  const { name, department, year } = request.query;

  let query = `SELECT u.id, u.name, sp.photo, d.name AS department 
               FROM User u 
               JOIN StudentProfile sp ON u.id = sp.user_id 
               JOIN Department d ON sp.department_id = d.id 
               WHERE 1=1`;
  const params = [];

  if (name) {
    query += ` AND u.name LIKE ?`;
    params.push(`%${name}%`);
  }
  if (department) {
    query += ` AND d.name = ?`;
    params.push(department);
  }
  if (year) {
    query += ` AND sp.year = ?`;
    params.push(year);
  }

  const students = await database.all(query, params);
  response.status(200).send(students);
});

// Contact Faculty Advisors
app.get("/students/advisors", async (request, response) => {
  const { studentId } = request.query; // Assuming student ID is passed as a query

  const selectAdvisorsQuery = `
    SELECT u.name, u.email, u.phone 
    FROM User u 
    JOIN FacultyProfile fp ON u.id = fp.user_id 
    WHERE fp.id IN (SELECT advisor_id FROM StudentProfile WHERE user_id = ?);`;

  const advisors = await database.all(selectAdvisorsQuery, [studentId]);

  if (advisors) {
    response.status(200).send(advisors);
  } else {
    response.status(404).send("Advisors not found");
  }
});

// Manage Class List for Faculty
app.get("/faculty/classes", async (request, response) => {
  const { facultyId } = request.query; // Assuming faculty ID is passed as a query

  const selectClassListQuery = `
    SELECT u.name, u.photo, u.email 
    FROM User u 
    JOIN Enrollment e ON u.id = e.student_id 
    JOIN Course c ON e.course_id = c.id 
    WHERE c.faculty_id = ?;`;

  const classList = await database.all(selectClassListQuery, [facultyId]);

  response.status(200).send(classList);
});

// Update Faculty Profile
app.put("/faculty/profile", async (request, response) => {
  const { facultyId, officeHours, email, phone } = request.body;

  const updateProfileQuery = `
    UPDATE FacultyProfile 
    SET office_hours = ?, email = ?, phone = ? 
    WHERE user_id = ?;`;

  await database.run(updateProfileQuery, [
    officeHours,
    email,
    phone,
    facultyId,
  ]);
  response.status(200).send("Profile updated successfully");
});

// Admin: Manage Student and Faculty Records
app.post("/admin/manage", async (request, response) => {
  const { action, userId, userData } = request.body; // Assuming action can be 'add', 'update', 'remove'

  if (action === "add") {
    const { username, password, role, name, email, phone } = userData;
    const hashedPassword = await bcrypt.hash(password, 10);
    const createUserQuery = `
      INSERT INTO User (username, password, role, name, email, phone) 
      VALUES (?, ?, ?, ?, ?, ?);`;

    await database.run(createUserQuery, [
      username,
      hashedPassword,
      role,
      name,
      email,
      phone,
    ]);
    response.status(201).send("User added successfully");
  } else if (action === "update") {
    const { name, email, phone } = userData;
    const updateUserQuery = `
      UPDATE User SET name = ?, email = ?, phone = ? WHERE id = ?;`;

    await database.run(updateUserQuery, [name, email, phone, userId]);
    response.status(200).send("User updated successfully");
  } else if (action === "remove") {
    const deleteUserQuery = `DELETE FROM User WHERE id = ?;`;
    await database.run(deleteUserQuery, [userId]);
    response.status(200).send("User removed successfully");
  } else {
    response.status(400).send("Invalid action");
  }
});

// Admin: Dashboard Data Aggregation
app.get("/admin/dashboard", async (request, response) => {
  const studentCountQuery = `SELECT COUNT(*) AS student_count FROM User WHERE role = 'STUDENT';`;
  const facultyCountQuery = `SELECT COUNT(*) AS faculty_count FROM User WHERE role = 'FACULTY_MEMBER';`;

  const studentCount = await database.get(studentCountQuery);
  const facultyCount = await database.get(facultyCountQuery);

  response.status(200).send({
    studentCount: studentCount.student_count,
    facultyCount: facultyCount.faculty_count,
    // Additional aggregation can be added here
  });
});
