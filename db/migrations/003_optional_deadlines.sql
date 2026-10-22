ALTER TABLE tasks ALTER COLUMN due_at DROP NOT NULL;
ALTER TABLE tasks ALTER COLUMN deadline_local DROP NOT NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_deadline_pair CHECK ((due_at IS NULL) = (deadline_local IS NULL));
