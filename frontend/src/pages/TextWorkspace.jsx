import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:8000'; // تأكد إن ده بورت الـ Backend بتاعك

export default function TextWorkspace() {
  const [courses, setCourses] = useState([]);
  const [courseDetails, setCourseDetails] = useState({});
  const [expandedCourses, setExpandedCourses] = useState({});
  const [expandedChapters, setExpandedChapters] = useState({});
  const [selectedVideos, setSelectedVideos] = useState(new Set());
  
  // حالات التحميل
  const [importJobId, setImportJobId] = useState(null);
  const [importProgress, setImportProgress] = useState(0);
  const [isImporting, setIsImporting] = useState(false);

  // جلب الكورسات أول ما الصفحة تفتح
  useEffect(() => {
    fetch(`${API_BASE}/courses`)
      .then(res => res.json())
      .then(data => setCourses(data))
      .catch(err => console.error("Error fetching courses:", err));
  }, []);

  // متابعة حالة التحميل (Polling)
  useEffect(() => {
    let interval;
    if (importJobId && isImporting) {
      interval = setInterval(() => {
        fetch(`${API_BASE}/transcripts/status/${importJobId}`)
          .then(res => res.json())
          .then(data => {
            if (data.status === 'running') {
              setImportProgress(data.progress);
            } else if (data.status === 'done' || data.status === 'error') {
              setImportProgress(data.status === 'done' ? 100 : 0);
              setIsImporting(false);
              setImportJobId(null);
              alert(data.status === 'done' ? 'تم استيراد النصوص بنجاح!' : 'حصل خطأ أثناء الاستيراد');
              clearInterval(interval);
            }
          });
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [importJobId, isImporting]);

  // جلب تفاصيل الكورس (الشباتر والفيديوهات) لما تفتح القائمة
  const toggleCourse = async (courseId) => {
    setExpandedCourses(prev => ({ ...prev, [courseId]: !prev[courseId] }));
    if (!courseDetails[courseId]) {
      try {
        const res = await fetch(`${API_BASE}/courses/${courseId}`);
        const data = await res.json();
        setCourseDetails(prev => ({ ...prev, [courseId]: data }));
      } catch (err) {
        console.error("Error fetching course details:", err);
      }
    }
  };

  const toggleChapter = (chapterId) => {
    setExpandedChapters(prev => ({ ...prev, [chapterId]: !prev[chapterId] }));
  };

  // تحديد الفيديوهات
  const handleVideoSelect = (videoId) => {
    const newSet = new Set(selectedVideos);
    if (newSet.has(videoId)) newSet.delete(videoId);
    else newSet.add(videoId);
    setSelectedVideos(newSet);
  };

  // تحديد كل فيديوهات الشابتر
  const handleChapterSelect = (chapter) => {
    const newSet = new Set(selectedVideos);
    const allSelected = chapter.videos.every(v => newSet.has(v.id));
    chapter.videos.forEach(v => {
      if (allSelected) newSet.delete(v.id);
      else newSet.add(v.id);
    });
    setSelectedVideos(newSet);
  };

  // بدأ استيراد النصوص للفيديوهات المحددة
  const startImport = async () => {
    if (selectedVideos.size === 0) return alert("حدد فيديوهات الأول يا باشا!");
    setIsImporting(true);
    setImportProgress(0);
    try {
      const res = await fetch(`${API_BASE}/transcripts/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: 'video',
          ids: Array.from(selectedVideos)
        })
      });
      const data = await res.json();
      setImportJobId(data.job_id);
    } catch (err) {
      console.error(err);
      setIsImporting(false);
    }
  };

  // دالة تحميل الملفات
  const handleExport = (type, id, format) => {
    window.open(`${API_BASE}/${type}/${id}/export?fmt=${format}`, '_blank');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto font-sans" dir="rtl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">مساحة عمل النصوص 📝</h1>
        <button 
          onClick={startImport}
          disabled={isImporting || selectedVideos.size === 0}
          className={`px-6 py-2 rounded text-white font-bold transition-colors ${
            isImporting ? 'bg-gray-400' : selectedVideos.size > 0 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-300'
          }`}
        >
          {isImporting ? 'جاري الاستيراد...' : `استيراد النصوص (${selectedVideos.size})`}
        </button>
      </div>

      {isImporting && (
        <div className="w-full bg-gray-200 rounded-full h-4 mb-6">
          <div className="bg-blue-600 h-4 rounded-full transition-all duration-500" style={{ width: `${importProgress}%` }}></div>
        </div>
      )}

      <div className="space-y-4">
        {courses.map(course => (
          <div key={course.id} className="border rounded-lg shadow-sm bg-white overflow-hidden">
            {/* رأس الكورس */}
            <div className="flex justify-between items-center p-4 bg-gray-50 border-b">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleCourse(course.id)}>
                <span className="text-xl">{expandedCourses[course.id] ? '🔽' : '◀️'}</span>
                <h2 className="text-lg font-bold">{course.title}</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleExport('courses', course.id, 'md')} className="text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300">MD</button>
                <button onClick={() => handleExport('courses', course.id, 'pdf')} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">PDF</button>
                <button onClick={() => handleExport('courses', course.id, 'json')} className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-200">JSON</button>
              </div>
            </div>

            {/* تفاصيل الكورس (شباتر وفيديوهات) */}
            {expandedCourses[course.id] && courseDetails[course.id] && (
              <div className="p-4 bg-white">
                {courseDetails[course.id].chapters.map(chapter => (
                  <div key={chapter.id} className="mb-4 pr-4 border-r-2 border-gray-200">
                    <div className="flex justify-between items-center bg-gray-50 p-2 rounded mb-2">
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4"
                          checked={chapter.videos.length > 0 && chapter.videos.every(v => selectedVideos.has(v.id))}
                          onChange={() => handleChapterSelect(chapter)}
                        />
                        <span className="cursor-pointer font-semibold text-gray-700" onClick={() => toggleChapter(chapter.id)}>
                          {expandedChapters[chapter.id] ? '📂' : '📁'} {chapter.title}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleExport('chapters', chapter.id, 'md')} className="text-xs bg-gray-200 px-2 py-1 rounded">MD</button>
                        <button onClick={() => handleExport('chapters', chapter.id, 'pdf')} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">PDF</button>
                      </div>
                    </div>

                    {/* فيديوهات الشابتر */}
                    {expandedChapters[chapter.id] && (
                      <div className="pr-8 space-y-2">
                        {chapter.videos.map(video => (
                          <div key={video.id} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded border text-sm">
                            <div className="flex items-center gap-3">
                              <input 
                                type="checkbox"
                                checked={selectedVideos.has(video.id)}
                                onChange={() => handleVideoSelect(video.id)}
                              />
                              <span className="text-gray-800">{video.title}</span>
                              {video.transcript && <span className="text-xs bg-green-100 text-green-700 px-1 rounded">✅ مسحوب</span>}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => handleExport('videos', video.id, 'md')} className="text-xs bg-gray-200 px-2 py-1 rounded">MD</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}