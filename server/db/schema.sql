-- Mezmurify local database setup.
-- Run with: sqlcmd -S localhost -E -C -v AppPassword="<password>" -i schema.sql

IF DB_ID('MezmurifyDB') IS NULL
BEGIN
    CREATE DATABASE MezmurifyDB;
END
GO

USE MezmurifyDB;
GO

-- Superseded by the Singers/Songs tables below.
IF OBJECT_ID('dbo.Mezmurs') IS NOT NULL
BEGIN
    DROP TABLE dbo.Mezmurs;
END
GO

IF OBJECT_ID('dbo.Singers') IS NULL
BEGIN
    CREATE TABLE dbo.Singers (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Name NVARCHAR(300) NOT NULL,
        AmharicName NVARCHAR(300) NULL,
        CONSTRAINT UQ_Singers_Name UNIQUE (Name)
    );
END
GO

-- Add AmharicName to installs created before this column existed.
IF COL_LENGTH('dbo.Singers', 'AmharicName') IS NULL
BEGIN
    ALTER TABLE dbo.Singers ADD AmharicName NVARCHAR(300) NULL;
END
GO

IF OBJECT_ID('dbo.Songs') IS NULL
BEGIN
    CREATE TABLE dbo.Songs (
        Id NVARCHAR(400) NOT NULL PRIMARY KEY,
        SingerId INT NOT NULL CONSTRAINT FK_Songs_Singers REFERENCES dbo.Singers(Id),
        Title NVARCHAR(400) NOT NULL,
        Lyrics NVARCHAR(MAX) NOT NULL,
        Language NVARCHAR(50) NOT NULL CONSTRAINT DF_Songs_Language DEFAULT 'Amharic',
        OpenSongID INT NULL,
        YoutubeVideoId NVARCHAR(20) NULL
    );
    CREATE INDEX IX_Songs_SingerId ON dbo.Songs(SingerId);
END
GO

-- Add Language to installs created before this column existed.
IF COL_LENGTH('dbo.Songs', 'Language') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD Language NVARCHAR(50) NOT NULL CONSTRAINT DF_Songs_Language DEFAULT 'Amharic';
END
GO

-- Original numeric identifier from the OpenSong filename, when available.
IF COL_LENGTH('dbo.Songs', 'OpenSongID') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD OpenSongID INT NULL;
END
GO

-- Generates IDs for new songs while preserving imported OpenSong IDs.
IF OBJECT_ID('dbo.OpenSongIDSequence', 'SO') IS NULL
BEGIN
    DECLARE @nextOpenSongID INT = ISNULL((SELECT MAX(OpenSongID) FROM dbo.Songs), 0) + 1;
    DECLARE @createOpenSongSequence NVARCHAR(4000) = N'CREATE SEQUENCE dbo.OpenSongIDSequence AS INT START WITH ' + CONVERT(NVARCHAR(20), @nextOpenSongID) + N' INCREMENT BY 1;';
    EXEC sys.sp_executesql @createOpenSongSequence;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Songs') AND name = 'OpenSongID' AND is_nullable = 1)
BEGIN
    ALTER TABLE dbo.Songs ALTER COLUMN OpenSongID INT NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('dbo.Songs') AND name = 'DF_Songs_OpenSongID')
BEGIN
    ALTER TABLE dbo.Songs ADD CONSTRAINT DF_Songs_OpenSongID DEFAULT (NEXT VALUE FOR dbo.OpenSongIDSequence) FOR OpenSongID;
END
GO

-- Caches the resolved YouTube video per song so we don't re-search on every view.
IF COL_LENGTH('dbo.Songs', 'YoutubeVideoId') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD YoutubeVideoId NVARCHAR(20) NULL;
END
GO

-- Optional admin-supplied local file path or Google Drive link, shown alongside YouTube.
IF COL_LENGTH('dbo.Songs', 'MediaUrl') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD MediaUrl NVARCHAR(1000) NULL;
END
GO

-- OpenSong-style verse-tagged rendering of Lyrics ([V1], [V2], ... before each stanza).
IF COL_LENGTH('dbo.Songs', 'OpenSongFormat') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD OpenSongFormat NVARCHAR(MAX) NULL;
END
GO

-- Visit counter and Facebook-style reaction totals.
IF COL_LENGTH('dbo.Songs', 'ViewCount') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD ViewCount INT NOT NULL CONSTRAINT DF_Songs_ViewCount DEFAULT 0;
END
GO
IF COL_LENGTH('dbo.Songs', 'LikeCount') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD LikeCount INT NOT NULL CONSTRAINT DF_Songs_LikeCount DEFAULT 0;
END
GO
IF COL_LENGTH('dbo.Songs', 'LoveCount') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD LoveCount INT NOT NULL CONSTRAINT DF_Songs_LoveCount DEFAULT 0;
END
GO
IF COL_LENGTH('dbo.Songs', 'HahaCount') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD HahaCount INT NOT NULL CONSTRAINT DF_Songs_HahaCount DEFAULT 0;
END
GO
IF COL_LENGTH('dbo.Songs', 'WowCount') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD WowCount INT NOT NULL CONSTRAINT DF_Songs_WowCount DEFAULT 0;
END
GO
IF COL_LENGTH('dbo.Songs', 'SadCount') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD SadCount INT NOT NULL CONSTRAINT DF_Songs_SadCount DEFAULT 0;
END
GO
IF COL_LENGTH('dbo.Songs', 'AngryCount') IS NULL
BEGIN
    ALTER TABLE dbo.Songs ADD AngryCount INT NOT NULL CONSTRAINT DF_Songs_AngryCount DEFAULT 0;
END
GO

IF OBJECT_ID('dbo.SongComments') IS NULL
BEGIN
    CREATE TABLE dbo.SongComments (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SongId NVARCHAR(400) NOT NULL CONSTRAINT FK_SongComments_Songs REFERENCES dbo.Songs(Id) ON DELETE CASCADE,
        Author NVARCHAR(200) NOT NULL,
        Comment NVARCHAR(2000) NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_SongComments_CreatedAt DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_SongComments_SongId ON dbo.SongComments(SongId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'mezmurify_app')
BEGIN
    CREATE LOGIN mezmurify_app WITH PASSWORD = '$(AppPassword)', CHECK_POLICY = ON;
END
GO

USE MezmurifyDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mezmurify_app')
BEGIN
    CREATE USER mezmurify_app FOR LOGIN mezmurify_app;
    ALTER ROLE db_datareader ADD MEMBER mezmurify_app;
    ALTER ROLE db_datawriter ADD MEMBER mezmurify_app;
END
GO
